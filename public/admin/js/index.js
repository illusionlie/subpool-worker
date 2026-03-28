const App = {
  state: {
    groups: [],
    config: {},
    selectedGroupToken: null,
    currentView: 'subscriptions',
    isNewGroup: false,
    confirmPromise: null,
    confirmMessage: '',
    theme: 'light'
  },

  escapeHtml(unsafe) {
    if (unsafe == null) {
      return '';
    }

    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  initTheme() {
    const preferredTheme = this.getPreferredTheme();
    this.state.theme = preferredTheme;
    this.applyTheme(preferredTheme);
  },

  getPreferredTheme() {
    let storedTheme;

    try {
      storedTheme = localStorage.getItem('subpool-theme');
    } catch (_err) {
      storedTheme = null;
    }

    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  applyTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    this.state.theme = normalizedTheme;

    try {
      localStorage.setItem('subpool-theme', normalizedTheme);
    } catch (_err) {
      // ignore storage errors in private mode
    }
  },

  toggleTheme() {
    const nextTheme = this.state.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(nextTheme);

    const toggleButton = document.querySelector('[data-action="toggle-theme"]');

    if (toggleButton) {
      toggleButton.textContent = this.getThemeToggleLabel();
    }
  },

  getThemeToggleLabel() {
    return this.state.theme === 'dark' ? '☀️ 亮色' : '🌙 暗色';
  },

  async init() {
    this.initTheme();
    this.cache = {
      app: document.getElementById('app'),
      toast: document.getElementById('toast'),
      modal: document.getElementById('modal-container')
    };

    this.attachEventListeners();
    await this.fetchData();
  },

  async fetchData() {
    try {
      const [groups, config] = await Promise.all([
        this.api.getGroups(),
        this.api.getConfig()
      ]);

      this.state.groups = groups;
      this.state.config = config;
    } catch (error) {
      console.error('Failed to fetch initial data:', error);
      this.cache.app.innerHTML = '<div class="loading-container" style="color: var(--danger-color);">加载数据失败，请刷新页面重试。</div>';
    } finally {
      this.render();
    }
  },

  api: {
    async request(endpoint, options = {}) {
      const defaultHeaders = { 'Content-Type': 'application/json' };
      const requestHeaders = {
        ...defaultHeaders,
        ...(options.headers || {})
      };

      if (options.body instanceof FormData) {
        delete requestHeaders['Content-Type'];
      }

      const response = await fetch(`/admin/api${endpoint}`, {
        ...options,
        headers: requestHeaders
      });

      if (response.status === 401) {
        window.location.reload();
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        let errorMessage = `API Error: ${response.statusText}`;

        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error === 'string' && errorPayload.error.trim()) {
            errorMessage = errorPayload.error;
          }
        } catch (_err) {
          // ignore parse errors
        }

        throw new Error(errorMessage);
      }

      const contentLength = response.headers.get('Content-Length');
      if (contentLength === '0') {
        return null;
      }

      const responseText = await response.text();
      if (!responseText) {
        return null;
      }

      try {
        return JSON.parse(responseText);
      } catch (_err) {
        return responseText;
      }
    },

    getConfig() {
      return this.request('/config');
    },

    saveConfig(data) {
      return this.request('/config', {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    getGroups() {
      return this.request('/groups');
    },

    createGroup(group) {
      return this.request('/groups', {
        method: 'POST',
        body: JSON.stringify(group)
      });
    },

    updateGroup(group) {
      return this.request(`/groups/${group.token}`, {
        method: 'PUT',
        body: JSON.stringify(group)
      });
    },

    deleteGroup(token) {
      return this.request(`/groups/${token}`, {
        method: 'DELETE'
      });
    },

    generateToken() {
      return Promise.resolve({ token: crypto.randomUUID() });
    },

    logout() {
      return this.request('/logout', {
        method: 'POST'
      });
    },

    exportData() {
      return this.request('/export');
    },

    importData(payload) {
      return this.request('/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  },

  attachEventListeners() {
    document.body.addEventListener('click', this.handleEvent.bind(this));
  },

  async handleEvent(event) {
    const actionTarget = event.target.closest?.('[data-action]');
    const action = actionTarget?.dataset.action;

    if (!action) {
      return;
    }

    event.preventDefault();

    switch (action) {
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
      case 'toggle-sidebar':
        this.toggleSidebar();
        break;
      case 'close-sidebar':
        this.closeSidebar();
        break;
      case 'toggle-theme':
        this.toggleTheme();
        break;
      case 'navigate':
        this.state.currentView = actionTarget.dataset.view;
        this.state.selectedGroupToken = null;
        this.state.isNewGroup = false;
        this.closeSidebar();
        this.render();
        break;
      case 'select-group':
        this.state.selectedGroupToken = actionTarget.dataset.token;
        this.state.isNewGroup = false;
        this.closeSidebar();
        this.render();
        break;
      case 'new-group':
        this.state.selectedGroupToken = null;
        this.state.isNewGroup = true;
        this.closeSidebar();
        this.render();
        break;
      case 'generate-token': {
        const { token } = await this.api.generateToken();
        document.getElementById('group-token').value = token;
        break;
      }
      case 'copy-url':
        await this.copyGroupUrl();
        break;
      case 'save-group':
        await this.saveGroup();
        break;
      case 'delete-group':
        if (await this.UI.confirm('确定要删除这个订阅组吗？此操作不可撤销。')) {
          await this.deleteGroup();
        }
        break;
      case 'save-settings':
        await this.saveSettings();
        break;
      case 'export-backup':
        await this.exportBackup();
        break;
      case 'import-backup':
        await this.importBackup();
        break;
      default:
        break;
    }
  },

  toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar && overlay) {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    }
  },

  closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar && overlay) {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    }
  },

  async refreshData() {
    try {
      [this.state.groups, this.state.config] = await Promise.all([
        this.api.getGroups(),
        this.api.getConfig()
      ]);
    } catch (error) {
      console.error('Failed to refresh data:', error);
      this.UI.showToast('数据刷新失败', 'error');
    }
  },

  async saveGroup() {
    const form = document.getElementById('group-form');
    const group = {
      name: form.elements['group-name'].value,
      allowChinaAccess: form.elements['allow-china'].checked,
      nodes: form.elements['group-nodes'].value,
      filter: {
        enabled: form.elements['filter-enabled'].checked,
        rules: form.elements['filter-rules'].value.split('\n').filter(Boolean)
      }
    };

    if (!this.state.isNewGroup) {
      group.token = form.elements['group-token'].value;
    }

    if (!group.name) {
      this.UI.showToast('组名不能为空！', 'error');
      return;
    }

    try {
      let savedGroup;

      if (this.state.isNewGroup) {
        savedGroup = await this.api.createGroup(group);
      } else {
        savedGroup = await this.api.updateGroup(group);
      }

      await this.refreshData();
      this.state.isNewGroup = false;
      this.state.selectedGroupToken = savedGroup.token;
      this.render();
      this.UI.showToast('保存成功！');
    } catch (error) {
      console.error(error);
      this.UI.showToast('保存失败', 'error');
    }
  },

  async deleteGroup() {
    const token = this.state.selectedGroupToken;

    try {
      await this.api.deleteGroup(token);
      await this.refreshData();
      this.state.selectedGroupToken = null;
      this.state.isNewGroup = false;
      this.render();
      this.UI.showToast('删除成功！');
    } catch (error) {
      console.error(error);
      this.UI.showToast('删除失败', 'error');
    }
  },

  async copyGroupUrl() {
    const token = this.state.selectedGroupToken;

    if (!token) {
      return;
    }

    const url = `${window.location.protocol}//${window.location.host}/sub/${token}`;

    try {
      await navigator.clipboard.writeText(url);
      this.UI.showToast('URL已复制到剪贴板！');
    } catch (error) {
      console.error('Failed to copy URL:', error);
      this.UI.showToast('复制失败，请手动复制', 'error');
    }
  },

  async saveSettings() {
    const form = document.getElementById('settings-form');
    const newConfig = {
      adminPassword: form.elements['admin-password'].value || undefined,
      failedBan: {
        enabled: form.elements['failed-ban-enabled'].checked,
        maxAttempts: Number.parseInt(form.elements['failed-ban-max-attempts'].value, 10) || 5,
        banDuration: Number.parseInt(form.elements['failed-ban-duration'].value, 10) || 600,
        failedAttemptsTtl: Number.parseInt(form.elements['failed-ban-ttl'].value, 10) || 600
      },
      telegram: {
        enabled: form.elements['tg-enabled'].checked,
        botToken: form.elements['tg-token'].value,
        chatId: form.elements['tg-chatid'].value
      },
      subconverter: {
        url: form.elements['subconverter-url'].value,
        configUrl: form.elements['subconverter-config'].value
      }
    };

    try {
      const result = await this.api.saveConfig(newConfig);
      const message = result?.passwordChanged
        ? '设置已保存！密码已更新，当前登录状态已自动刷新。'
        : '设置已保存！';
      this.UI.showToast(message);
      await this.refreshData();
      this.render();
    } catch (error) {
      console.error(error);
      this.UI.showToast('保存失败', 'error');
    }
  },

  downloadJsonFile(fileName, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },

  buildDefaultBackupFileName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `subpool-backup-${datePart}-${timePart}.json`;
  },

  async exportBackup() {
    try {
      const exportData = await this.api.exportData();
      const fileName = this.buildDefaultBackupFileName();
      this.downloadJsonFile(fileName, exportData);
      this.UI.showToast('导出成功，备份文件已下载。');
    } catch (error) {
      console.error(error);
      this.UI.showToast(error.message || '导出失败', 'error');
    }
  },

  parseJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || ''));
          resolve(parsed);
        } catch (_err) {
          reject(new Error('JSON 文件解析失败，请检查文件格式。'));
        }
      };

      reader.onerror = () => {
        reject(new Error('读取文件失败。'));
      };

      reader.readAsText(file, 'utf-8');
    });
  },

  async importBackup() {
    const confirmed = await this.UI.confirm('导入会覆盖当前所有订阅组，并按备份内容更新配置。是否继续？');
    if (!confirmed) {
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';

    const selectedFile = await new Promise((resolve) => {
      fileInput.addEventListener('change', () => {
        resolve(fileInput.files?.[0] || null);
      }, { once: true });
      fileInput.click();
    });

    if (!selectedFile) {
      return;
    }

    try {
      const payload = await this.parseJsonFile(selectedFile);
      await this.api.importData(payload);
      await this.refreshData();
      this.state.selectedGroupToken = null;
      this.state.isNewGroup = false;
      this.render();
      this.UI.showToast('导入成功，数据已刷新。');
    } catch (error) {
      console.error(error);
      this.UI.showToast(error.message || '导入失败', 'error');
    }
  },

  UI: {
    showToast(message, type = 'success') {
      App.cache.toast.textContent = message;
      App.cache.toast.style.backgroundColor = type === 'error'
        ? 'var(--danger-color)'
        : 'var(--success-color)';
      App.cache.toast.classList.add('show');
      setTimeout(() => App.cache.toast.classList.remove('show'), 3000);
    },

    confirm(message) {
      App.state.confirmMessage = message;
      App.cache.modal.innerHTML = this.renderConfirmModal();

      return new Promise((resolve) => {
        App.state.confirmPromise = { resolve };
      });
    },

    renderConfirmModal() {
      return `
        <div class="modal-overlay">
          <div class="modal-box">
            <h2>请确认</h2>
            <p>${App.escapeHtml(App.state.confirmMessage)}</p>
            <div class="modal-actions">
              <button class="btn btn-secondary" data-action="cancel-action">取消</button>
              <button class="btn btn-danger" data-action="confirm-action">确认</button>
            </div>
          </div>
        </div>
      `;
    }
  },

  render() {
    this.cache.app.innerHTML = `
      <header class="header">
        <div class="header-left">
          <button class="mobile-menu-btn" data-action="toggle-sidebar">☰</button>
          <h1>SubPool Worker</h1>
          <nav class="nav">
            <button data-action="navigate" data-view="subscriptions" class="${this.state.currentView === 'subscriptions' ? 'active' : ''}">订阅管理</button>
            <button data-action="navigate" data-view="settings" class="${this.state.currentView === 'settings' ? 'active' : ''}">全局设置</button>
          </nav>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary btn-sm theme-toggle" data-action="toggle-theme" aria-label="切换亮暗模式">${this.getThemeToggleLabel()}</button>
          <button class="btn btn-secondary btn-sm" data-action="logout">登出</button>
        </div>
      </header>
      <main class="main-content">
        <div class="sidebar-overlay" data-action="close-sidebar"></div>
        ${this.state.currentView === 'subscriptions' ? this.renderSubscriptionsView() : this.renderSettingsView()}
      </main>
    `;

    this.cache.modal.innerHTML = this.state.confirmPromise
      ? this.UI.renderConfirmModal()
      : '';
  },

  renderMobileNav() {
    return `
      <div class="mobile-nav">
        <div class="sidebar-item ${this.state.currentView === 'subscriptions' ? 'active' : ''}" data-action="navigate" data-view="subscriptions">
          📋 订阅管理
        </div>
        <div class="sidebar-item ${this.state.currentView === 'settings' ? 'active' : ''}" data-action="navigate" data-view="settings">
          ⚙️ 全局设置
        </div>
        <hr style="margin: 10px 0; border: none; border-top: 1px solid var(--border-color);">
      </div>
    `;
  },

  renderSubscriptionsView() {
    return `
      <aside class="sidebar">
        ${this.renderMobileNav()}
        <div class="sidebar-item new" data-action="new-group"> + 创建新订阅组 </div>
        ${this.state.groups.map((group) => `
          <div class="sidebar-item ${(this.state.selectedGroupToken === group.token && !this.state.isNewGroup) ? 'active' : ''}" data-action="select-group" data-token="${this.escapeHtml(group.token)}">
            ${this.escapeHtml(group.name)}
          </div>
        `).join('')}
      </aside>
      <section class="content-area">
        ${(this.state.selectedGroupToken || this.state.isNewGroup)
          ? this.renderGroupEditor()
          : '<div class="form-container"><p>请从左侧选择一个订阅组进行编辑，或创建一个新组。</p></div>'}
      </section>
    `;
  },

  renderGroupEditor() {
    const group = this.state.isNewGroup
      ? {
          name: '',
          token: '',
          allowChinaAccess: false,
          nodes: '',
          filter: {
            enabled: false,
            rules: []
          }
        }
      : this.state.groups.find((item) => item.token === this.state.selectedGroupToken);

    if (!group) {
      return '<div class="form-container"><p>无法找到该订阅组。</p></div>';
    }

    return `
      <div class="form-container">
        <form id="group-form">
          <h2>${this.state.isNewGroup ? '创建新订阅组' : `编辑: ${this.escapeHtml(group.name)}`}</h2>
          <div class="form-group">
            <label for="group-name">组名</label>
            <input type="text" id="group-name" value="${this.escapeHtml(group.name)}">
          </div>
          ${!this.state.isNewGroup ? `
            <div class="form-group">
              <label for="group-token">Token</label>
              <div class="token-group">
                <input type="text" id="group-token" value="${this.escapeHtml(group.token)}" readonly>
                <button type="button" class="btn btn-secondary" data-action="generate-token">随机</button>
                <button type="button" class="btn btn-secondary" data-action="copy-url">复制URL</button>
              </div>
            </div>
          ` : ''}
          <div class="form-group">
            <label for="group-nodes">订阅链接 / 节点 (每行一个)</label>
            <textarea id="group-nodes">${this.escapeHtml(group.nodes ?? '')}</textarea>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="allow-china" ${group.allowChinaAccess ? 'checked' : ''}>
            <label for="allow-china">允许中国大陆 IP 访问</label>
          </div>
          <fieldset>
            <legend>过滤器</legend>
            <div class="form-group checkbox-group">
              <input type="checkbox" id="filter-enabled" ${group.filter?.enabled ? 'checked' : ''}>
              <label for="filter-enabled">启用节点过滤器</label>
            </div>
            <div class="form-group">
              <label for="filter-rules">过滤规则 (每行一个正则表达式, e.g., /过期/i)</label>
              <textarea id="filter-rules" placeholder="/剩余流量/i
/过期时间/i">${this.escapeHtml((group.filter?.rules ?? []).join('\n'))}</textarea>
            </div>
          </fieldset>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-action="save-group">保存</button>
            ${!this.state.isNewGroup ? '<button type="button" class="btn btn-danger" data-action="delete-group">删除</button>' : ''}
          </div>
        </form>
      </div>
    `;
  },

  renderSettingsView() {
    const cfg = this.state.config;

    return `
      <aside class="sidebar">
        ${this.renderMobileNav()}
        <div class="sidebar-item active">全局设置</div>
      </aside>
      <section class="content-area">
        ${this.renderSettingsForm(cfg)}
      </section>
    `;
  },

  renderSettingsForm(cfg) {
    return `
      <div class="form-container settings-form-container">
        <form id="settings-form">
          <h2 class="settings-title">全局设置</h2>
          <div class="settings-grid">
            <div class="settings-column">
              <fieldset>
                <legend>安全设置</legend>
                <div class="form-group">
                  <label for="admin-password">管理密码 (留空则不修改)</label>
                  <input type="password" id="admin-password" placeholder="输入新密码">
                </div>
              </fieldset>
              <fieldset>
                <legend>登录失败防护</legend>
                <div class="form-group checkbox-group">
                  <input type="checkbox" id="failed-ban-enabled" ${cfg.failedBan?.enabled ? 'checked' : ''}>
                  <label for="failed-ban-enabled">启用登录失败防护</label>
                </div>
                <div class="form-group">
                  <label for="failed-ban-max-attempts">最大失败次数</label>
                  <input type="number" id="failed-ban-max-attempts" value="${cfg.failedBan?.maxAttempts ?? 5}" min="1" max="100">
                  <small>达到此次数后将被临时封禁</small>
                </div>
                <div class="form-group">
                  <label for="failed-ban-duration">封禁时长 (秒)</label>
                  <input type="number" id="failed-ban-duration" value="${cfg.failedBan?.banDuration ?? 600}" min="60" max="86400">
                  <small>封禁持续时间，默认600秒(10分钟)</small>
                </div>
                <div class="form-group">
                  <label for="failed-ban-ttl">失败记录保留时间 (秒)</label>
                  <input type="number" id="failed-ban-ttl" value="${cfg.failedBan?.failedAttemptsTtl ?? 600}" min="60" max="86400">
                  <small>失败尝试记录的保留时间</small>
                </div>
              </fieldset>
            </div>
            <div class="settings-column">
              <fieldset>
                <legend>Telegram 通知</legend>
                <div class="form-group checkbox-group">
                  <input type="checkbox" id="tg-enabled" ${cfg.telegram?.enabled ? 'checked' : ''}>
                  <label for="tg-enabled">启用 TG 通知</label>
                </div>
                <div class="form-group">
                  <label for="tg-token">Bot Token</label>
                  <input type="text" id="tg-token" value="${this.escapeHtml(cfg.telegram?.botToken ?? '')}">
                </div>
                <div class="form-group">
                  <label for="tg-chatid">Chat ID</label>
                  <input type="text" id="tg-chatid" value="${this.escapeHtml(cfg.telegram?.chatId ?? '')}">
                </div>
              </fieldset>
              <fieldset>
                <legend>订阅转换</legend>
                <div class="form-group">
                  <label for="subconverter-url">Subconverter 后端地址 (不含 http(s)://)</label>
                  <input type="text" id="subconverter-url" value="${this.escapeHtml(cfg.subconverter?.url ?? '')}">
                </div>
                <div class="form-group">
                  <label for="subconverter-config">Subconverter 配置文件 URL</label>
                  <input type="text" id="subconverter-config" value="${this.escapeHtml(cfg.subconverter?.configUrl ?? '')}">
                </div>
              </fieldset>
            </div>
          </div>
          <div class="actions actions-center settings-actions">
            <button class="btn btn-secondary" data-action="export-backup">导出备份</button>
            <button class="btn btn-secondary" data-action="import-backup">导入备份</button>
            <button class="btn btn-primary" data-action="save-settings">保存设置</button>
          </div>
        </form>
      </div>
    `;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  void App.init();
});
