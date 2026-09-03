'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const 空 = () => ({
    email: $('email').value.trim(),
    key: $('key').value.trim()
  });
  let 部署中 = false;
  let 当前模式 = 'create';

  function 日志(文本) {
    const 时间 = new Date().toLocaleTimeString();
    const 面板 = $('logs');
    const 行 = document.createElement('div');
    行.textContent = `[${时间}] ${文本}`;
    面板.appendChild(行);
    面板.scrollTop = 面板.scrollHeight;
  }

  function 设置状态(目标, 文本, ok) {
    目标.textContent = 文本;
    目标.classList.toggle('success', !!ok);
    目标.classList.remove('error');
  }

  // 部署结果统一写入独立结果卡片（日志与操作卡片之间，常驻吸顶）
  function 写入结果(文本, ok) {
    const 面板 = $('resultPanel');
    面板.classList.remove('page-hidden');
    const 目标 = $('result');
    目标.textContent = 文本;
    目标.classList.toggle('success', !!ok);
    目标.classList.toggle('error', !ok);
    同步吸顶();
  }

  function 显示错误(错误) {
    const 文本 = 错误 && 错误.message ? 错误.message : String(错误);
    写入结果('失败: ' + 文本, false);
    日志('失败: ' + 文本);
  }

  function 标红输入框(id) {
    const el = $(id);
    if (el) el.classList.add('input-error');
  }

  function 使用中(按钮, 使用) {
    if (!按钮) return;
    按钮.disabled = 使用;
    按钮.classList.toggle('busy', 使用);
    if (按钮.dataset.label !== undefined) 按钮.textContent = 使用 ? '处理中…' : 按钮.dataset.label;
  }

  function 设置按钮标签(按钮) {
    if (按钮) 按钮.dataset.label = 按钮.textContent;
  }

  function 随机密码(长度 = 16) {
    const 表 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const 字节 = crypto.getRandomValues(new Uint8Array(长度));
    return [...字节].map(b => 表[b % 表.length]).join('');
  }

  async function 复制文本(值, 名称) {
    if (!值) return 日志(`${名称}为空，无可复制`);
    try {
      await navigator.clipboard.writeText(值);
      日志(`已复制${名称}: ${值}`);
    } catch {
      let 成功 = false;
      try {
        const 临时 = document.createElement('textarea');
        临时.value = 值;
        临时.style.position = 'fixed';
        临时.style.opacity = '0';
        document.body.appendChild(临时);
        临时.focus();
        临时.select();
        临时.setSelectionRange(0, 值.length);
        成功 = document.execCommand('copy');
        document.body.removeChild(临时);
      } catch {
        成功 = false;
      }
      if (成功) 日志(`已复制${名称}: ${值}`);
      else 日志(`复制受限，请在日志中手动复制: ${值}`);
    }
  }

  // 顶栏（标题栏 + 日志栏 + 结果卡）吸顶高度同步
  function 同步吸顶() {
    const 根 = document.documentElement;
    const header = document.querySelector('.hero');
    const logs = $('logsPanel');
    const h = header ? header.offsetHeight : 0;
    let lh = 0;
    if (document.body.classList.contains('deployed') && logs && !logs.classList.contains('page-hidden')) {
      lh = logs.offsetHeight;
    }
    根.style.setProperty('--topbar-h', h + 'px');
    根.style.setProperty('--logh', lh + 'px');
  }

  // 日志折叠：状态记在 localStorage，移动端默认折叠
  function 日志折叠状态() {
    const 存 = localStorage.getItem('logCollapsed');
    const 移动端 = window.innerWidth <= 720;
    if (存 === null) return 移动端;
    return 存 === '1';
  }

  function 应用日志折叠() {
    const 面板 = $('logsPanel');
    const 折叠 = 日志折叠状态();
    面板.classList.toggle('collapsed', 折叠);
    $('toggleLogs').textContent = 折叠 ? '展开' : '折叠';
    同步吸顶();
  }

  function 生成随机名称(前缀) {
    return `${前缀}-${crypto.randomUUID().slice(0, 8)}`;
  }

  // 项目名与 KV 名共用同一个 8 位编码，方便管理
  function 生成一致名称() {
    const code = crypto.randomUUID().slice(0, 8);
    return { projectName: `edge-${code}`, kvTitle: `store-${code}` };
  }

  function 补齐一致名称(payload) {
    if (payload.deployMode !== 'create') return payload;
    const 项目 = String(payload.projectName || '').trim();
    const kv = String(payload.kvTitle || '').trim();
    if (!项目) {
      const 一致 = 生成一致名称();
      payload.projectName = 一致.projectName;
      if (!kv) payload.kvTitle = 一致.kvTitle;
    } else if (!kv) {
      const code = (项目.replace(/^edge[-_]?/i, '').match(/[a-z0-9]{8}$/) || [''])[0] || crypto.randomUUID().slice(0, 8);
      payload.kvTitle = `store-${code}`;
    }
    return payload;
  }

  function 更新域名预览() {
    const zone = $('quickZone').value;
    const 绑定 = $('bindDomain').checked;
    if (绑定 && zone) {
      const 名称 = $('quickZone').selectedOptions[0].textContent;
      $('quickHostnamePreview').value = `${生成随机名称('edge')}.${名称}`;
    } else {
      $('quickHostnamePreview').value = '不绑定域名';
    }
  }

  function 预填选填KV(名称) {
    const kvTitle = $('kvTitle');
    if (名称 && !kvTitle.value.trim()) kvTitle.value = 名称;
  }

  // 随机新建 / 更新现有 切换
  function 切换操作模式(mode) {
    当前模式 = mode === 'update' ? 'update' : 'create';
    const 更新 = 当前模式 === 'update';
    document.querySelectorAll('#opSelect .op-btn').forEach(按钮 => {
      按钮.classList.toggle('active', 按钮.dataset.mode === 当前模式);
    });
    $('updateArea').classList.toggle('page-hidden', !更新);
    $('quickPanel').classList.toggle('muted', 更新);
    // 随机新建卡片：更新模式下禁用
    const 禁用字段 = ['quickAdmin', 'quickZone', 'bindDomain', 'quickDeploy', 'accountId', 'deployType',
      'projectName', 'admin', 'randomAdmin', 'copyAdmin', 'randomQuickAdmin', 'copyQuickAdmin',
      'zoneId', 'advancedHostname', 'kvTitle', 'kvId', 'edtUuid', 'newUuid', 'copyUuid',
      'edtKey', 'edtProxyip', 'edtUrl', 'edtGo2socks5', 'edtDebug', 'edtOfflog', 'edtBestsub',
      'edtPreload', 'edtTcp', 'edtProxyConcurrent', 'workersDevMode', 'newNames', 'deploy'];
    禁用字段.forEach(id => { const 元素 = $(id); if (元素) 元素.disabled = 更新; });
    const 现有 = $('existingProject');
    if (现有) 现有.disabled = !更新;
    const 提示 = $('modeHint');
    if (提示) {
      提示.textContent = 更新
        ? '更新模式在左侧卡片选择现有项目即可，只同步代码，不修改变量、KV、域名或项目配置。'
        : '新建模式会按表单配置变量、KV 和可选域名；留空的选填参数不会写入。';
    }
  }

  async function 拉取(路径, 数据) {
    const 响应 = await fetch(路径, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(数据)
    });
    const 结果 = await 响应.json();
    if (!结果.ok) throw new Error(结果.error || `请求失败(${响应.status})`);
    return 结果;
  }

  async function 登录() {
    const 凭据 = 空();
    if (!凭据.email || !凭据.key) return 设置状态($('loginStatus'), '请填写邮箱和 Key', false);
    const 按钮 = $('loginButton');
    try {
      使用中(按钮, true);
      const 结果 = await 拉取('/api/accounts', { credentials: 凭据 });
      if (!结果.accounts.length) throw new Error('当前凭据没有可用账户');
      设置状态($('loginStatus'), `登录成功，账户: ${结果.accounts[0].name}`, true);
      $('loginPage').classList.add('page-hidden');
      $('deployPage').classList.remove('page-hidden');
      document.body.classList.add('deployed');
      同步吸顶();
      日志(`登录成功: ${结果.accounts[0].name} (${结果.accounts[0].id})`);
      // 先刷新账户/域名，再读取现有资源，避免 Account 未填充导致"缺少 Account ID"
      await 刷新账户();
      await 刷新资源();
    } catch (错误) {
      设置状态($('loginStatus'), '失败: ' + (错误.message || 错误), false);
      日志('失败: ' + (错误.message || 错误));
    } finally {
      使用中(按钮, false);
    }
  }

  async function 刷新账户() {
    try {
      const 凭据 = 空();
      const [accounts, zones] = await Promise.all([
        拉取('/api/accounts', { credentials: 凭据 }),
        拉取('/api/zones', { credentials: 凭据 })
      ]);
      if (accounts.accounts.length) {
        $('accountId').innerHTML = accounts.accounts.map(账户 => `<option value="${账户.id}">${账户.name}</option>`).join('');
      }
      if (zones.zones.length) {
        const 选项 = zones.zones.map(区域 => `<option value="${区域.id}">${区域.name}</option>`).join('');
        $('zoneId').innerHTML = 选项;
        $('quickZone').innerHTML = '<option value="">不绑定域名</option>' + 选项;
      } else {
        $('zoneId').innerHTML = '<option value="">暂无域名</option>';
        $('quickZone').innerHTML = '<option value="">暂无域名</option>';
      }
      日志(`账户/域名已刷新：${accounts.accounts.length} 个账户、${zones.zones.length} 个域名`);
      return true;
    } catch (错误) {
      日志(`刷新账户/域名失败：${错误.message}`);
      return false;
    }
  }

  async function 刷新资源() {
    const accountId = $('accountId').value;
    if (!accountId) {
      日志('暂无 Account，请先刷新账户');
      return [];
    }
    try {
      const 凭据 = 空();
      const 数据 = { credentials: 凭据, accountId };
      const 结果 = await 拉取('/api/resources', 数据);
      const 现有项目 = 结果.pages.map(项目 => ({
        id: 项目.name,
        name: 项目.name,
        type: 'pages',
        kvId: 项目.kvId
      })).concat(结果.workers.map(项目 => ({
        id: 项目.name,
        name: `Worker: ${项目.name}`,
        type: 'worker',
        kvId: ''
      })));
      const 现有 = 现有项目.map(项目 => `<option value="${项目.id}" data-type="${项目.type}">${项目.name}</option>`).join('');
      $('existingProject').innerHTML = 现有 || '<option value="">暂无项目</option>';
      const kv = 结果.kvs.map(空间 => `<option value="${空间.id}">${空间.title}</option>`).join('');
      $('kvId').innerHTML = '<option value="">自动新建</option>' + kv;
      if (结果.warnings.length) 结果.warnings.forEach(警告 => 日志('警告: ' + 警告));
      日志(`现有资源已加载：${结果.pages.length} 个 Pages、${结果.workers.length} 个 Worker、${结果.kvs.length} 个 KV`);
      return 现有项目;
    } catch (错误) {
      日志(`读取现有资源失败：${错误.message}`);
      return [];
    }
  }

  function 收集选填() {
    return {
      key: $('edtKey').value.trim(),
      uuid: $('edtUuid').value.trim(),
      proxyip: $('edtProxyip').value.trim(),
      url: $('edtUrl').value.trim(),
      go2socks5: $('edtGo2socks5').value.trim(),
      debug: $('edtDebug').value.trim(),
      offlog: $('edtOfflog').value.trim(),
      bestsub: $('edtBestsub').value.trim(),
      preload: $('edtPreload').value.trim(),
      tcpConcurrent: $('edtTcp').value.trim(),
      proxyConcurrent: $('edtProxyConcurrent').value.trim(),
      enableWorkersDev: $('workersDevMode').value === '1'
    };
  }

  function 表单基础() {
    const payload = {
      credentials: 空(),
      accountId: $('accountId').value,
      deployType: $('deployType').value,
      projectName: $('projectName').value.trim(),
      admin: $('admin').value.trim(),
      deployMode: 当前模式,
      kvTitle: $('kvTitle').value.trim(),
      kvId: $('kvId').value,
      zoneId: $('zoneId').value,
      hostname: $('advancedHostname').value.trim(),
      ...收集选填()
    };
    return 补齐一致名称(payload);
  }

  function 一键参数() {
    const 绑定 = $('bindDomain').checked;
    const zone = $('quickZone').value;
    const zoneName = 绑定 && zone ? $('quickZone').selectedOptions[0].textContent : '';
    const payload = {
      credentials: 空(),
      accountId: $('accountId').value,
      deployType: 'pages',
      projectName: '',
      admin: $('quickAdmin').value.trim(),
      deployMode: 'create',
      kvTitle: '',
      kvId: '',
      autoDomain: 绑定 && zone,
      zoneId: zone || '',
      zoneName,
      hostname: '',
      ...收集选填()
    };
    return 补齐一致名称(payload);
  }

  function 更新参数() {
    const 选择 = $('existingProject');
    const 选项 = 选择.selectedOptions[0];
    return {
      credentials: 空(),
      accountId: $('accountId').value,
      deployType: 选项 && 选项.dataset.type ? 选项.dataset.type : 'pages',
      projectName: 选项 ? 选项.value : '',
      admin: '',
      deployMode: 'update',
      kvTitle: '',
      kvId: '',
      zoneId: '',
      hostname: ''
    };
  }

  async function 提交部署(payload, 按钮) {
    if (部署中) return;
    if (!payload.credentials.email || !payload.credentials.key) {
      return 写入结果('请先登录', false);
    }
    if (payload.deployMode === 'create' && !payload.admin) {
      写入结果('请填写 ADMIN 后台密码', false);
      标红输入框(按钮 && 按钮.id === 'quickDeploy' ? 'quickAdmin' : 'admin');
      return;
    }
    if (payload.deployMode === 'update' && !payload.projectName) {
      return 写入结果('请选择要更新的现有项目', false);
    }
    部署中 = true;
    try {
      使用中(按钮, true);
      写入结果('部署中…', false);
      日志(`开始部署 ${payload.deployMode === 'update' ? '更新' : '新建'} ${payload.deployType}`);
      const 结果 = await 拉取('/api/deploy', payload);
      (结果.logs || []).forEach(行 => 日志(行));
      if (结果.logs && !结果.logs.length) 日志('部署完成');
      写入结果(格式化结果(结果), true);
      日志('部署成功');
      预填选填KV(结果.kv ? 结果.kv.title : '');
    } catch (错误) {
      显示错误(错误);
    } finally {
      部署中 = false;
      使用中(按钮, false);
    }
  }

  function 格式化结果(结果) {
    const 行 = [];
    const 类型 = 结果.deployType === 'worker' ? 'Worker' : 'Pages';
    if (结果.projectName) 行.push(`${类型} 项目: ${结果.projectName}`);
    const 域名 = [];
    if (结果.domain && 结果.domain.hostname) 域名.push(结果.domain.hostname);
    (结果.domains || []).forEach(项 => { if (项.hostname && !域名.includes(项.hostname)) 域名.push(项.hostname); });
    if (域名.length) 行.push(`域名: ${域名.join('、')}`);
    if (结果.uuid) 行.push(`UUID: ${结果.uuid}`);
    const 访问 = (结果.domain && 结果.domain.hostname) || 域名[0] || `${结果.projectName}.${结果.deployType === 'worker' ? 'workers.dev' : 'pages.dev'}`;
    if (结果.admin) 行.push(`后台地址: https://${访问}/admin`);
    行.push(`后台密码: ${结果.admin}`);
    return 行.join('\n');
  }

  function 绑定事件() {
    ['loginButton', 'quickDeploy', 'deploy', 'updateDeploy'].forEach(id => 设置按钮标签($(id)));
    $('loginButton').addEventListener('click', 登录);
    $('backToLogin').addEventListener('click', () => {
      $('deployPage').classList.add('page-hidden');
      $('loginPage').classList.remove('page-hidden');
      document.body.classList.remove('deployed');
      $('resultPanel').classList.add('page-hidden');
      同步吸顶();
    });
    $('quickDeploy').addEventListener('click', () => 提交部署(一键参数(), $('quickDeploy')));
    $('deploy').addEventListener('click', () => 提交部署(表单基础(), $('deploy')));
    $('updateDeploy').addEventListener('click', () => 提交部署(更新参数(), $('updateDeploy')));
    document.querySelectorAll('#opSelect .op-btn').forEach(按钮 => {
      按钮.addEventListener('click', () => 切换操作模式(按钮.dataset.mode));
    });
    $('loadAccounts').addEventListener('click', () => { 日志('刷新账户/域名中…'); 刷新账户().then(ok => { if (ok) 刷新资源(); }); });
    $('loadResources').addEventListener('click', () => { 日志('读取现有项目…'); 刷新资源(); });
    $('clearLogs').addEventListener('click', () => { $('logs').textContent = ''; });
    $('toggleLogs').addEventListener('click', () => {
      const 面板 = $('logsPanel');
      const 折叠 = 面板.classList.toggle('collapsed');
      localStorage.setItem('logCollapsed', 折叠 ? '1' : '0');
      $('toggleLogs').textContent = 折叠 ? '展开' : '折叠';
      同步吸顶();
    });
    $('newNames').addEventListener('click', () => {
      const 一致 = 生成一致名称();
      $('projectName').value = 一致.projectName;
      $('kvTitle').value = 一致.kvTitle;
      日志(`已生成：项目 ${一致.projectName} / KV ${一致.kvTitle}`);
    });
    $('newUuid').addEventListener('click', () => {
      $('edtUuid').value = crypto.randomUUID();
      日志(`已生成 UUID: ${$('edtUuid').value}`);
    });
    $('copyUuid').addEventListener('click', () => 复制文本($('edtUuid').value.trim(), 'UUID'));
    $('randomQuickAdmin').addEventListener('click', () => {
      $('quickAdmin').value = 随机密码();
      日志(`已生成随机密码: ${$('quickAdmin').value}`);
    });
    $('copyQuickAdmin').addEventListener('click', () => 复制文本($('quickAdmin').value.trim(), '密码'));
    $('randomAdmin').addEventListener('click', () => {
      $('admin').value = 随机密码();
      日志(`已生成随机密码: ${$('admin').value}`);
    });
    $('copyAdmin').addEventListener('click', () => 复制文本($('admin').value.trim(), '密码'));
    $('bindDomain').addEventListener('change', 更新域名预览);
    $('quickZone').addEventListener('change', 更新域名预览);
    $('accountId').addEventListener('change', () => { 日志('Account 已切换，重新读取现有资源…'); 刷新资源(); });
    // 输入时清除标红
    ['quickAdmin', 'admin', 'email', 'key'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => el.classList.remove('input-error'));
    });
    window.addEventListener('resize', 同步吸顶);
    切换操作模式('create');
    应用日志折叠();
  }

  document.addEventListener('DOMContentLoaded', 绑定事件);
})();
