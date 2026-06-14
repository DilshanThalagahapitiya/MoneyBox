#!/usr/bin/env python3
import os

from backend.app import create_app

PORT = int(os.environ.get("PORT", 8080))
app = create_app()


if __name__ == "__main__":
    print(f"Money Collection running at http://localhost:{PORT}")
    print(f"Database: data/app.db")
    app.run(host="0.0.0.0", port=PORT, debug=False)
