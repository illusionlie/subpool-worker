/**
 * Renders the complete single-page application for the admin interface.
 * This version is clean of any authentication logic, assuming it's handled upstream.
 */
export function renderAdminPage() {
  const style = `
    <style>
      :root {
          --bg-color: #f8f9fa; --text-color: #212529; --primary-color: #007bff;
          --border-color: #dee2e6; --card-bg: #fff; --sidebar-bg: #e9ecef;
          --hover-bg: #d8dde2; --active-bg: #007bff; --active-text: #fff;
          --danger-color: #dc3545; --success-color: #28a745;
      }
      body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
          margin: 0; background-color: var(--bg-color); color: var(--text-color);
          display: flex; height: 100vh; overflow: hidden;
      }
      #app { display: flex; flex-direction: column; width: 100%; height: 100%; }
      .header {
          background-color: var(--card-bg); border-bottom: 1px solid var(--border-color);
          padding: 0 20px; display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0; height: 60px; z-index: 10;
      }
      .header-left { display: flex; align-items: center; gap: 20px; }
      .header h1 { font-size: 20px; margin: 0; }
      .nav button {
          font-size: 16px; padding: 8px 16px; border: none; background: none; cursor: pointer;
          border-bottom: 2px solid transparent;
      }
      .nav button.active { border-bottom-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
      .main-content { display: flex; flex-grow: 1; overflow: hidden; }
      .sidebar {
          width: 280px; background-color: var(--sidebar-bg); padding: 10px;
          border-right: 1px solid var(--border-color); display: flex; flex-direction: column;
          overflow-y: auto; flex-shrink: 0;
      }
      .sidebar-item {
          padding: 12px 15px; border-radius: 6px; cursor: pointer;
          margin-bottom: 5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sidebar-item:hover { background-color: var(--hover-bg); }
      .sidebar-item.active { background-color: var(--active-bg); color: var(--active-text); }
      .sidebar-item.new { color: var(--primary-color); border: 1px dashed var(--primary-color); text-align: center; }
      .content-area { flex-grow: 1; padding: 30px 0; overflow-y: auto; }
      .form-container {
          max-width: 960px;
          margin: 0 auto;
          padding: 0 20px;
      }
      .form-group { margin-bottom: 20px; }
      label { display: block; font-weight: 600; margin-bottom: 8px; }
      input[type="text"], input[type="password"], textarea {
          width: 100%; padding: 10px; border: 1px solid var(--border-color);
          border-radius: 4px; font-size: 14px; box-sizing: border-box;
      }
      textarea { height: 200px; font-family: "SF Mono", "Fira Code", monospace; resize: vertical; }
      .token-group { display: flex; align-items: center; }
      .token-group input { flex-grow: 1; }
      .token-group button { margin-left: 10px; }
      .checkbox-group { display: flex; align-items: center; }
      .checkbox-group input { margin-right: 10px; width: auto; }
      .btn {
          padding: 10px 20px; font-size: 16px; border: none; border-radius: 5px;
          cursor: pointer; transition: background-color 0.2s;
      }
      .btn-sm { padding: 5px 10px; font-size: 14px; }
      .btn-primary { background-color: var(--primary-color); color: #fff; }
      .btn-primary:hover { background-color: #0056b3; }
      .btn-danger { background-color: var(--danger-color); color: #fff; }
      .btn-danger:hover { background-color: #c82333; }
      .btn-secondary { background-color: #6c757d; color: #fff; }
      .btn-secondary:hover { background-color: #5a6268; }
      .actions { display: flex; justify-content: space-between; margin-top: 20px; }
      .actions-center { justify-content: center; }
      #toast {
          position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
          padding: 10px 20px; background-color: rgba(0,0,0,0.7); color: white;
          border-radius: 5px; z-index: 1001; opacity: 0; transition: opacity 0.5s;
      }
      #toast.show { opacity: 1; }
      .modal-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background-color: rgba(0, 0, 0, 0.5); z-index: 1000;
          display: flex; align-items: center; justify-content: center;
      }
      .modal-box {
          background: var(--card-bg); padding: 25px; border-radius: 8px;
          box-shadow: 0 5px 15px rgba(0,0,0,0.3); width: 90%; max-width: 400px;
      }
      .modal-box h2 { margin-top: 0; }
      .modal-actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }
      .spinner {
          border: 4px solid #f3f3f3; border-top: 4px solid var(--primary-color);
          border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      .loading-container { display: flex; align-items: center; justify-content: center; height: 100%; gap: 10px; font-size: 18px; color: #6c757d; }
  </style>
  `;

  const script = `
    const App = {
      // --- STATE ---
      state: {
          groups: [], config: {},
          selectedGroupToken: null, currentView: 'subscriptions',
          isNewGroup: false,
          confirmPromise: null, confirmMessage: ''
      },

      // --- SECURITY: HTML ESCAPING ---
      escapeHtml(unsafe) {
          if (unsafe == null) return '';
          return String(unsafe)
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
      },

      // --- INITIALIZATION ---
      async init() {
          this.cache = {
              app: document.getElementById('app'),
              toast: document.getElementById('toast'),
              modal: document.getElementById('modal-container'),
          };

          this.attachEventListeners();
          await this.fetchData();
      },
      
      // --- FETCH DATA ---
      async fetchData() {
          try {
              const [groups, config] = await Promise.all([this.api.getGroups(), this.api.getConfig()]);
              this.state.groups = groups;
              this.state.config = config;
          } catch (error) {
              console.error("Failed to fetch initial data:", error);
              this.cache.app.innerHTML = '<div class="loading-container" style="color: var(--danger-color);">加载数据失败，请刷新页面重试。</div>';
          } finally {
              this.render();
          }
      },

      // --- API SERVICE ---
      api: {
          async request(endpoint, options = {}) {
              const response = await fetch(\`/admin/api\${endpoint}\`, { 
                  headers: { 'Content-Type': 'application/json' },
                  ...options 
              });
              if (response.status === 401) { // If session expires
                  window.location.reload();
                  throw new Error('Unauthorized');
              }
              if (!response.ok) throw new Error(\`API Error: \${response.statusText}\`);
              return response.json();
          },
          getConfig() { return this.request('/config'); },
          saveConfig(data) { return this.request('/config', { method: 'PUT', body: JSON.stringify(data) }); },
          getGroups() { return this.request('/groups'); },
          createGroup(group) { return this.request('/groups', { method: 'POST', body: JSON.stringify(group) }); },
          updateGroup(group) { return this.request(\`/groups/\${group.token}\`, { method: 'PUT', body: JSON.stringify(group) }); },
          deleteGroup(token) { return this.request(\`/groups/\${token}\`, { method: 'DELETE' }); },
          generateToken() { return this.request('/utils/gentoken'); },
          logout() { return this.request('/logout', { method: 'POST' }); }
      },

      // --- EVENT HANDLING ---
      attachEventListeners() {
          document.body.addEventListener('click', this.handleEvent.bind(this));
      },

      async handleEvent(e) {
          const action = e.target.dataset.action;
          if (!action) return;
          e.preventDefault();

          switch(action) {
              case 'logout':
                  await this.api.logout();
                  window.location.reload();
                  break;
              case 'confirm-action':
                  this.state.confirmPromise?.resolve(true);
                  this.state.confirmPromise = null;
                  this.cache.modal.innerHTML = '';
                  break;
              case 'cancel-action':
                  this.state.confirmPromise?.resolve(false);
                  this.state.confirmPromise = null;
                  this.cache.modal.innerHTML = '';
                  break;
              case 'navigate': this.state.currentView = e.target.dataset.view; this.state.selectedGroupToken = null; this.state.isNewGroup = false; this.render(); break;
              case 'select-group': this.state.selectedGroupToken = e.target.dataset.token; this.state.isNewGroup = false; this.render(); break;
              case 'new-group': this.state.selectedGroupToken = null; this.state.isNewGroup = true; this.render(); break;
              case 'generate-token': const { token } = await this.api.generateToken(); document.getElementById('group-token').value = token; break;
              case 'save-group': await this.saveGroup(); break;
              case 'delete-group': if (await this.UI.confirm('确定要删除这个订阅组吗？此操作不可撤销。')) await this.deleteGroup(); break;
              case 'save-settings': await this.saveSettings(); break;
          }
      },
      
      // --- ACTIONS ---
      async refreshData() { try { [this.state.groups, this.state.config] = await Promise.all([this.api.getGroups(), this.api.getConfig()]); } catch (error) { console.error('Failed to refresh data:', error); this.UI.showToast('数据刷新失败', 'error'); } },
      async saveGroup() { const form = document.getElementById('group-form'); const group = { name: form.elements['group-name'].value, token: form.elements['group-token'].value, allowChinaAccess: form.elements['allow-china'].checked, nodes: form.elements['group-nodes'].value, filter: { enabled: form.elements['filter-enabled'].checked, rules: form.elements['filter-rules'].value.split('\\n').filter(Boolean) } }; if (!group.name || !group.token) { this.UI.showToast('组名和 Token 不能为空！', 'error'); return; } try { let savedGroup; if (this.state.isNewGroup) { savedGroup = await this.api.createGroup(group); } else { savedGroup = await this.api.updateGroup(group); } await this.refreshData(); this.state.isNewGroup = false; this.state.selectedGroupToken = savedGroup.token; this.render(); this.UI.showToast('保存成功！'); } catch (err) { console.error(err); this.UI.showToast('保存失败', 'error'); } },
      async deleteGroup() { const token = this.state.selectedGroupToken; try { await this.api.deleteGroup(token); await this.refreshData(); this.state.selectedGroupToken = null; this.state.isNewGroup = false; this.render(); this.UI.showToast('删除成功！'); } catch (err) { console.error(err); this.UI.showToast('删除失败', 'error'); } },
      async saveSettings() { const form = document.getElementById('settings-form'); const newConfig = { adminPassword: form.elements['admin-password'].value || undefined, blockBots: form.elements['block-bots'].checked, telegram: { enabled: form.elements['tg-enabled'].checked, botToken: form.elements['tg-token'].value, chatId: form.elements['tg-chatid'].value, }, subconverter: { url: form.elements['subconverter-url'].value, configUrl: form.elements['subconverter-config'].value, } }; try { await this.api.saveConfig(newConfig); this.UI.showToast('设置已保存！如果修改了密码，下次登录生效。'); await this.refreshData(); this.render(); } catch (err) { console.error(err); this.UI.showToast('保存失败', 'error'); } },
      
      // --- UI & RENDERING ---
      UI: {
          showToast(message, type = 'success') { App.cache.toast.textContent = message; App.cache.toast.style.backgroundColor = type === 'error' ? 'var(--danger-color)' : 'var(--success-color)'; App.cache.toast.classList.add('show'); setTimeout(() => App.cache.toast.classList.remove('show'), 3000); },
          confirm(message) { App.state.confirmMessage = message; App.cache.modal.innerHTML = this.renderConfirmModal(); return new Promise(resolve => { App.state.confirmPromise = { resolve }; }); },
          renderConfirmModal() { return \` <div class="modal-overlay"> <div class="modal-box"> <h2>请确认</h2> <p>\${App.escapeHtml(App.state.confirmMessage)}</p> <div class="modal-actions"> <button class="btn btn-secondary" data-action="cancel-action">取消</button> <button class="btn btn-danger" data-action="confirm-action">确认</button> </div> </div> </div> \`; },
      },

      render() {
          this.cache.app.innerHTML = \`
              <header class="header">
                  <div class="header-left">
                      <h1>订阅管理</h1>
                      <nav class="nav">
                          <button data-action="navigate" data-view="subscriptions" class="\${this.state.currentView === 'subscriptions' ? 'active' : ''}">订阅管理</button>
                          <button data-action="navigate" data-view="settings" class="\${this.state.currentView === 'settings' ? 'active' : ''}">全局设置</button>
                      </nav>
                  </div>
                  <button class="btn btn-secondary btn-sm" data-action="logout">登出</button>
              </header>
              <main class="main-content">
                  \${this.state.currentView === 'subscriptions' ? this.renderSubscriptionsView() : this.renderSettingsView()}
              </main>
          \`;
          this.cache.modal.innerHTML = this.state.confirmPromise ? this.UI.renderConfirmModal() : '';
      },
      renderSubscriptionsView() { return \` <aside class="sidebar"> <div class="sidebar-item new" data-action="new-group"> + 创建新订阅组 </div> \${this.state.groups.map(g => \`<div class="sidebar-item \${(this.state.selectedGroupToken === g.token && !this.state.isNewGroup) ? 'active' : ''}" data-action="select-group" data-token="\${this.escapeHtml(g.token)}"> \${this.escapeHtml(g.name)} </div>\`).join('')} </aside> <section class="content-area"> \${(this.state.selectedGroupToken || this.state.isNewGroup) ? this.renderGroupEditor() : '<div class="form-container"><p>请从左侧选择一个订阅组进行编辑，或创建一个新组。</p></div>'} </section> \`; },
      renderGroupEditor() { const group = this.state.isNewGroup ? { name: '', token: '', allowChinaAccess: false, nodes: '', filter: { enabled: false, rules: [] } } : this.state.groups.find(g => g.token === this.state.selectedGroupToken); if (!group) return '<div class="form-container"><p>无法找到该订阅组。</p></div>'; return \` <div class="form-container"> <form id="group-form"> <h2>\${this.state.isNewGroup ? '创建新订阅组' : '编辑: ' + this.escapeHtml(group.name)}</h2> <div class="form-group"> <label for="group-name">组名</label> <input type="text" id="group-name" value="\${this.escapeHtml(group.name)}"> </div> <div class="form-group"> <label for="group-token">Token</label> <div class="token-group"> <input type="text" id="group-token" value="\${this.escapeHtml(group.token)}" \${!this.state.isNewGroup ? 'readonly' : ''}> \${this.state.isNewGroup ? '<button class="btn btn-secondary" data-action="generate-token">随机</button>' : ''} </div> </div> <div class="form-group"> <label for="group-nodes">订阅链接 / 节点 (每行一个)</label> <textarea id="group-nodes">\${this.escapeHtml(group.nodes || '')}</textarea> </div> <div class="form-group checkbox-group"> <input type="checkbox" id="allow-china" \${group.allowChinaAccess ? 'checked' : ''}> <label for="allow-china">允许中国大陆 IP 访问</label> </div> <fieldset> <legend>过滤器</legend> <div class="form-group checkbox-group"> <input type="checkbox" id="filter-enabled" \${group.filter && group.filter.enabled ? 'checked' : ''}> <label for="filter-enabled">启用节点过滤器</label> </div> <div class="form-group"> <label for="filter-rules">过滤规则 (每行一个正则表达式, e.g., /过期/i)</label> <textarea id="filter-rules" placeholder="/剩余流量/i\\n/过期时间/i">\${this.escapeHtml((group.filter && group.filter.rules || []).join('\\n'))}</textarea> </div> </fieldset> <div class="actions"> <button class="btn btn-primary" data-action="save-group">保存</button> \${!this.state.isNewGroup ? '<button class="btn btn-danger" data-action="delete-group">删除</button>' : ''} </div> </form> </div> \`; },
      renderSettingsView() { const cfg = this.state.config; return \` <div class="form-container"> <form id="settings-form"> <h2>全局设置</h2> <fieldset> <legend>安全设置</legend> <div class="form-group"> <label for="admin-password">管理密码 (留空则不修改)</label> <input type="password" id="admin-password" placeholder="输入新密码"> </div> <div class="form-group checkbox-group"> <input type="checkbox" id="block-bots" \${cfg.blockBots ? 'checked' : ''}> <label for="block-bots">阻止常见爬虫/机器人访问</label> </div> </fieldset> <fieldset> <legend>Telegram 通知</legend> <div class="form-group checkbox-group"> <input type="checkbox" id="tg-enabled" \${cfg.telegram && cfg.telegram.enabled ? 'checked' : ''}> <label for="tg-enabled">启用 TG 通知</label> </div> <div class="form-group"> <label for="tg-token">Bot Token</label> <input type="text" id="tg-token" value="\${this.escapeHtml(cfg.telegram && cfg.telegram.botToken || '')}"> </div> <div class="form-group"> <label for="tg-chatid">Chat ID</label> <input type="text" id="tg-chatid" value="\${this.escapeHtml(cfg.telegram && cfg.telegram.chatId || '')}"> </div> </fieldset> <fieldset> <legend>订阅转换</legend> <div class="form-group"> <label for="subconverter-url">Subconverter 后端地址 (不含 http(s)://)</label> <input type="text" id="subconverter-url" value="\${this.escapeHtml(cfg.subconverter && cfg.subconverter.url || '')}"> </div> <div class="form-group"> <label for="subconverter-config">Subconverter 配置文件 URL</label> <input type="text" id="subconverter-config" value="\${this.escapeHtml(cfg.subconverter && cfg.subconverter.configUrl || '')}"> </div> </fieldset> <div class="actions actions-center"> <button class="btn btn-primary" data-action="save-settings">保存设置</button> </div> </form> </div> \`; }
    };
    document.addEventListener('DOMContentLoaded', () => App.init());
  `;

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>订阅管理后台</title>
        ${style}
    </head>
    <body>
        <div id="app">
            <div class="loading-container">
                <div class="spinner"></div>
                <span>正在加载应用数据...</span>
            </div>
        </div>
        <div id="modal-container"></div>
        <div id="toast"></div>

        <script>
            ${script}
        </script>
    </body>
    </html>
  `;
}