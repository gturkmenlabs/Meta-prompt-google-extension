// Login is owned by the official CLIs; this app never reads or copies OAuth tokens.
(() => {
  const native = (provider, operation, prompt) => window.webkit.messageHandlers.native.postMessage({action:'account', provider, operation, prompt});
  globalThis.desktopAccountProvider = 'chatgpt';
  globalThis.desktopRevise = async (provider, plan) => {
    const prompt = plan.system + '\n\n' + plan.userText +
      '\n\nReturn only the revised prompt, not an answer to its task. Do not use tools, inspect files, or perform the requested task.';
    const response = await native(provider, 'generate', prompt);
    if (!response?.result) throw new Error(response?.message || 'No result returned.');
    return response.result;
  };
  document.addEventListener('DOMContentLoaded', async () => {
    const main = document.querySelector('.mp-view') || document.querySelector('.ms-body');
    if (!main) return;
    const section = document.createElement('section');
    section.className = 'account-panel';
    section.innerHTML = '<span class="eyebrow">CONNECTED ACCOUNTS</span><h2>Use your subscription</h2>' +
      '<p>No API key needed. Uses Codex, Claude Code or OpenCode access from your own subscriptions; account limits apply.</p>' +
      '<label for="accountProvider">Generate with</label><select id="accountProvider"><option value="chatgpt">ChatGPT account · Codex</option><option value="claude">Claude account · Claude Code</option><option value="opencode">OpenCode · your providers</option><option value="">API key · advanced</option></select>' +
      '<div class="account-actions"><button id="accountConnect">Sign in</button><button id="accountCheck">Check connection</button></div>' +
      '<p id="accountStatus" role="status" aria-live="polite"></p>';
    main.prepend(section);
    const select = section.querySelector('select'), status = section.querySelector('#accountStatus');
    const buttons = section.querySelectorAll('button');
    let generation = 0;
    const render = () => {
      const enabled = Boolean(select.value);
      globalThis.desktopAccountProvider = select.value;
      buttons.forEach(b => b.hidden = !enabled);
      const consensus = document.getElementById('consensusRow');
      if (consensus) consensus.style.setProperty('display', enabled ? 'none' : 'flex', 'important');
      document.querySelectorAll('.ms-body > .ms-field, .ms-body > .ms-div, .ms-body > .ms-hero').forEach(el => el.hidden = enabled);
    };
    const check = async (operation = 'status') => {
      const provider = select.value, serial = ++generation;
      if (!provider) { status.textContent = 'Configure your API provider below.'; return; }
      status.textContent = operation === 'login' ? (provider === 'opencode' ? 'Opening Terminal for OpenCode sign-in…' : 'Complete sign-in in your browser. This can take a few minutes…') : 'Checking your account…';
      buttons.forEach(b => b.disabled = true); select.disabled = true;
      try {
        const response = await native(provider, operation);
        if (serial !== generation) return;
        status.textContent = response.message;
        if (operation === 'login') {
          const verified = await native(provider, 'status');
          status.textContent = verified.message;
        }
      } catch (error) { status.textContent = error.message || String(error); }
      finally { buttons.forEach(b => b.disabled = false); select.disabled = false; }
    };
    const stored = await chrome.storage.local.get('desktopAccountProvider');
    select.value = ['chatgpt', 'claude', 'opencode', ''].includes(stored.desktopAccountProvider) ? stored.desktopAccountProvider : 'chatgpt';
    render(); check();
    select.addEventListener('change', async () => {
      render();
      await chrome.storage.local.set({desktopAccountProvider:select.value});
      check();
    });
    section.querySelector('#accountCheck').addEventListener('click', () => check());
    section.querySelector('#accountConnect').addEventListener('click', () => check('login'));
  });
})();
