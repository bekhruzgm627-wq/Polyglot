const state = {
  token: localStorage.getItem('polyglot_token') || '',
  user: null
};

const els = {
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.form-panel'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  accountPanel: document.getElementById('account-panel'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  xpRange: document.getElementById('xp-range'),
  xpValue: document.getElementById('xp-value'),
  logoutBtn: document.getElementById('logout-btn'),
  googleBtn: document.getElementById('google-login'),
  message: document.getElementById('message')
};

function showMessage(text, type = 'success') {
  els.message.textContent = text;
  els.message.className = `message ${type}`;
  els.message.classList.remove('hidden');
}

function hideMessage() {
  els.message.classList.add('hidden');
}

function setActiveTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });

  document.querySelectorAll('.form-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${name}-panel`);
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }

  return data;
}

function renderUser(user) {
  if (!user) {
    els.accountPanel.classList.add('hidden');
    els.loginForm.closest('.form-panel').classList.remove('hidden');
    return;
  }

  els.userName.textContent = user.name || 'Пользователь';
  els.userEmail.textContent = user.email || '';
  els.xpRange.value = String(user.progress?.xp || 0);
  els.xpValue.textContent = String(user.progress?.xp || 0);

  document.querySelectorAll('.form-panel').forEach((panel) => panel.classList.add('hidden'));
  els.accountPanel.classList.remove('hidden');
}

async function loadMe() {
  if (!state.token) return renderUser(null);

  try {
    const progress = await api('/api/progress');
    state.user = { ...state.user, progress };
    renderUser(state.user);
  } catch (err) {
    state.token = '';
    localStorage.removeItem('polyglot_token');
    renderUser(null);
  }
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage();

  try {
    const form = new FormData(els.loginForm);
    const payload = Object.fromEntries(form.entries());
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = data.token;
    localStorage.setItem('polyglot_token', data.token);
    state.user = { email: payload.email, name: payload.email.split('@')[0] };
    await loadMe();
    showMessage('Успешный вход', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage();

  try {
    const form = new FormData(els.registerForm);
    const payload = Object.fromEntries(form.entries());
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = data.token;
    localStorage.setItem('polyglot_token', data.token);
    state.user = { name: payload.name, email: payload.email };
    await loadMe();
    showMessage('Аккаунт создан', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

els.logoutBtn.addEventListener('click', () => {
  state.token = '';
  state.user = null;
  localStorage.removeItem('polyglot_token');
  renderUser(null);
  setActiveTab('login');
  hideMessage();
});

els.xpRange.addEventListener('input', async (e) => {
  if (!state.token || !state.user) return;

  const xp = Number(e.target.value);
  els.xpValue.textContent = String(xp);

  try {
    const progress = { ...state.user.progress, xp };
    await api('/api/progress', {
      method: 'PUT',
      body: JSON.stringify({ vocabulary: progress.vocabulary || {}, xp, course: progress.course || 'es' })
    });
    state.user.progress = progress;
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

async function initGoogle() {
  try {
    const cfg = await api('/api/config');
    if (!cfg.googleClientId) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (response) => {
          try {
            const data = await api('/api/auth/google', {
              method: 'POST',
              body: JSON.stringify({ credential: response.credential })
            });
            state.token = data.token;
            localStorage.setItem('polyglot_token', data.token);
            state.user = { email: data.email, name: data.email.split('@')[0] };
            await loadMe();
            showMessage('Google вход выполнен', 'success');
          } catch (err) {
            showMessage(err.message, 'error');
          }
        }
      });

      google.accounts.id.renderButton(document.getElementById('google-login'), {
        theme: 'outline',
        size: 'large',
        width: '100%'
      });
    };
    document.body.appendChild(script);
  } catch {
    // Google не настроен — кнопка останется как обычная.
  }
}

setActiveTab('login');
loadMe();
initGoogle();
