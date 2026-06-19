(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const usersEl = document.getElementById('login-users');
  const timeEl = document.getElementById('login-time');

  function setError(msg) {
    errorEl.textContent = msg || '';
  }

  function tickTime() {
    const d = new Date();
    const fmt = (n) => String(n).padStart(2, '0');
    timeEl.textContent = `${d.getFullYear()}-${fmt(d.getMonth()+1)}-${fmt(d.getDate())}  ${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`;
  }
  setInterval(tickTime, 1000);
  tickTime();

  async function loadUsers() {
    try {
      const resp = await fetch('/api/health');
      if (!resp.ok) return;
      usersEl.innerHTML = '';
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'login-user-chip';
      chip.textContent = 'user (admin)';
      chip.addEventListener('click', () => { userInput.value = 'user'; passInput.focus(); });
      usersEl.appendChild(chip);
    } catch {}
  }

  loadUsers();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) { setError('Please enter username and password'); return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err.error === 'invalid_credentials' ? 'Invalid username or password.' : (err.message || 'Sign in failed.'));
        submit.disabled = false;
        submit.textContent = 'Sign in';
        return;
      }
      const data = await resp.json();
      sessionStorage.setItem('nocoos_token', data.token);
      sessionStorage.setItem('nocoos_user', JSON.stringify(data.user));
      window.location.href = '/desktop';
    } catch (err) {
      setError('Network error: ' + err.message);
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
})();
