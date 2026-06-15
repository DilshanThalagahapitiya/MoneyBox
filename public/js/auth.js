async function redirectIfAuthenticated() {
  try {
    const response = await fetch("/api/auth/me");
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
    const response = await fetch("/api/auth/me");
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
