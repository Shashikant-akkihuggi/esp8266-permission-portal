// Admin Login Script
document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('loginForm');
  const alertEl = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('submitBtn');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  // Check if already authenticated
  try {
    const sessionRes = await fetch('/api/auth/session');
    if (sessionRes.ok) {
      const data = await sessionRes.json();
      if (data && data.authenticated) {
        window.location.replace('/admin/dashboard.html');
        return;
      }
    }
  } catch (err) {
    // Continue to login
  }

  function showAlert(msg) {
    alertEl.textContent = msg;
    alertEl.style.display = 'block';
  }

  function hideAlert() {
    alertEl.style.display = 'none';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showAlert('Username and password are required');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying credentials...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.replace('/admin/dashboard.html');
      } else {
        showAlert(data.error || 'Authentication failed');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    } catch (err) {
      showAlert('Network error connecting to login server');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
});
