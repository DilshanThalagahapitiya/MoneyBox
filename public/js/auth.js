// --- Tab-Scoped Session Management ---
// Generate a unique tab ID that persists for the lifetime of this browser tab.
// sessionStorage is automatically cleared when the tab is closed, and is
// NOT shared between tabs — giving us natural tab isolation.
(function() {
  let tabId = sessionStorage.getItem("_mb_tab_id");
  if (!tabId) {
    tabId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("_mb_tab_id", tabId);
  }

  // Override the global fetch to automatically attach the X-Tab-Id header
  // to every request. This ensures ALL fetch calls across the app (including
  // those in app.js, admin.html inline scripts, etc.) use the correct tab-scoped session.
  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    init = init || {};
    init.headers = init.headers || {};
    
    // Handle Headers object vs plain object
    if (init.headers instanceof Headers) {
      if (!init.headers.has("X-Tab-Id")) {
        init.headers.set("X-Tab-Id", tabId);
      }
    } else {
      init.headers["X-Tab-Id"] = tabId;
    }

    return originalFetch.call(window, input, init);
  };
})();

async function redirectIfAuthenticated() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await response.json();
    if (data.authenticated) {
      window.location.href = "/";
    }
  } catch (error) {
    // Stay on auth page if the session check fails.
  }
}

function setFormMessage(message, isError = false) {
  const messageEl = document.getElementById("form-message");
  if (!messageEl) {
    return;
  }

  messageEl.textContent = message;
  messageEl.classList.toggle("error", isError);
  messageEl.classList.toggle("success", !isError && Boolean(message));
}

function setupAuthForm({
  formId,
  submitUrl,
  getPayload,
  successRedirect,
  successMessage,
  onSuccess,
}) {
  const form = document.getElementById(formId);
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormMessage("");

    const formData = new FormData(form);
    const payload = getPayload(formData);

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.classList.add("loading");

    try {
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        setFormMessage(data.error || "Request failed", true);
      } else if (onSuccess) {
        onSuccess(data, setFormMessage);
      } else if (successRedirect) {
        setFormMessage(successMessage || "Success!");
        setTimeout(() => {
          window.location.href = successRedirect;
        }, 1000);
      }
    } catch (error) {
      setFormMessage("Network error occurred. Please try again.", true);
    } finally {
      if (submitBtn) submitBtn.classList.remove("loading");
    }
  });
}

async function requireAuth() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await response.json();

    if (!data.authenticated) {
      window.location.href = "/login.html";
      return null;
    }

    return data.user;
  } catch (error) {
    window.location.href = "/login.html";
    return null;
  }
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
}

window.appAlert = function(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay custom-alert-overlay";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex"; // Override hidden display behavior
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s ease";
    
    const content = document.createElement("div");
    content.className = "modal-content";
    content.style.maxWidth = "350px";
    content.style.textAlign = "center";
    content.style.transform = "scale(0.95)";
    content.style.transition = "transform 0.2s ease";
    
    const header = document.createElement("div");
    header.className = "modal-header";
    header.style.borderBottom = "none";
    header.style.justifyContent = "center";
    header.style.paddingBottom = "0";
    header.style.paddingTop = "1.5rem";
    
    const titleEl = document.createElement("h2");
    titleEl.textContent = title;
    titleEl.style.fontSize = "1.2rem";
    titleEl.style.margin = "0";
    header.appendChild(titleEl);
    
    const body = document.createElement("div");
    body.style.padding = "1rem 1.5rem";
    body.style.color = "var(--text-muted)";
    body.style.fontSize = "0.95rem";
    body.style.lineHeight = "1.5";
    body.textContent = message;
    
    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "1rem";
    footer.style.padding = "0.5rem 1.5rem 1.5rem";
    footer.style.justifyContent = "center";
    
    if (isConfirm) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn-secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.flex = "1";
      cancelBtn.style.padding = "0.6rem";
      cancelBtn.onclick = () => {
        closeAndResolve(false);
      };
      
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn-primary";
      confirmBtn.textContent = "Confirm";
      confirmBtn.style.flex = "1";
      confirmBtn.style.padding = "0.6rem";
      confirmBtn.onclick = () => {
        closeAndResolve(true);
      };
      
      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);
    } else {
      const okBtn = document.createElement("button");
      okBtn.className = "btn-primary";
      okBtn.textContent = "OK";
      okBtn.style.flex = "1";
      okBtn.style.padding = "0.6rem";
      okBtn.onclick = () => {
        closeAndResolve(true);
      };
      footer.appendChild(okBtn);
    }
    
    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    
    function closeAndResolve(val) {
      overlay.style.opacity = "0";
      content.style.transform = "scale(0.95)";
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        resolve(val);
      }, 200);
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      content.style.transform = "scale(1)";
    });
  });
};

window.appPrompt = function(title, message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay custom-alert-overlay";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s ease";
    
    const content = document.createElement("div");
    content.className = "modal-content";
    content.style.maxWidth = "350px";
    content.style.textAlign = "center";
    content.style.transform = "scale(0.95)";
    content.style.transition = "transform 0.2s ease";
    
    const header = document.createElement("div");
    header.className = "modal-header";
    header.style.borderBottom = "none";
    header.style.justifyContent = "center";
    header.style.paddingBottom = "0";
    header.style.paddingTop = "1.5rem";
    
    const titleEl = document.createElement("h2");
    titleEl.textContent = title;
    titleEl.style.fontSize = "1.2rem";
    titleEl.style.margin = "0";
    header.appendChild(titleEl);
    
    const body = document.createElement("div");
    body.style.padding = "1rem 1.5rem";
    body.style.color = "var(--text-muted)";
    body.style.fontSize = "0.95rem";
    body.style.lineHeight = "1.5";
    body.textContent = message;
    
    const inputWrapper = document.createElement("div");
    inputWrapper.style.marginTop = "1rem";
    
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.value = defaultValue;
    inputEl.style.width = "100%";
    inputEl.style.padding = "0.75rem";
    inputEl.style.borderRadius = "var(--radius-sm)";
    inputEl.style.border = "1px solid rgba(255,255,255,0.15)";
    inputEl.style.background = "rgba(255,255,255,0.05)";
    inputEl.style.color = "var(--text)";
    inputEl.style.fontSize = "1rem";
    inputEl.style.textAlign = "center";
    
    inputWrapper.appendChild(inputEl);
    body.appendChild(inputWrapper);
    
    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "1rem";
    footer.style.padding = "0.5rem 1.5rem 1.5rem";
    footer.style.justifyContent = "center";
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.flex = "1";
    cancelBtn.style.padding = "0.6rem";
    cancelBtn.onclick = () => closeAndResolve(null);
    
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-primary";
    confirmBtn.textContent = "Submit";
    confirmBtn.style.flex = "1";
    confirmBtn.style.padding = "0.6rem";
    confirmBtn.onclick = () => closeAndResolve(inputEl.value);
    
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    
    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    
    inputEl.focus();
    
    // Support pressing Enter
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") closeAndResolve(inputEl.value);
      if (e.key === "Escape") closeAndResolve(null);
    });
    
    function closeAndResolve(val) {
      overlay.style.opacity = "0";
      content.style.transform = "scale(0.95)";
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        resolve(val);
      }, 200);
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      content.style.transform = "scale(1)";
    });
  });
};