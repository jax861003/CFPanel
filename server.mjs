// 云端部署器 —— edgetunnel 单源版（本地调试服务，Node）
// 与 functions/api/[[path]].js 逻辑一致；本地 Pages 部署走 wrangler CLI
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const 端口 = Number(process.env.PORT || 8790);
const 静态目录 = resolve(import.meta.dirname, 'public');
const 源码目录 = resolve(import.meta.dirname, 'public', 'sources');
const 接口地址 = 'https://api.cloudflare.com/client/v4';

const 部署源 = {
  label: 'edgetunnel（cmliu）',
  repoBase: 'https://raw.githubusercontent.com/cmliu/edgetunnel/main',
  fileName: '_worker.js',
  kvBinding: 'KV',
  compatibilityDate: '2025-11-04',
  mainModule: '_worker.js'
};

const 服务 = createServer(async (请求, 响应) => {
  try {
    if (请求.url.startsWith('/api/')) {
      await 处理接口(请求, 响应);
      return;
    }
    await 处理静态文件(请求, 响应);
  } catch (错误) {
    返回JSON(响应, 500, {
      ok: false,
      error: 错误.message || String(错误)
    });
  }
});

服务.listen(端口, () => {
  console.log(`云端部署器已启动: http://localhost:${端口}`);
});

async function 处理接口(请求, 响应) {
  if (请求.method !== 'POST') {
    返回JSON(响应, 405, { ok: false, error: '只支持 POST' });
    return;
  }
  const 数据 = await 读取JSON(请求);
  if (请求.url === '/api/accounts') {
    const accounts = await 调用接口(数据.credentials, '/accounts?per_page=50');
    返回JSON(响应, 200, { ok: true, accounts: accounts.map(账户 => ({ id: 账户.id, name: 账户.name })) });
    return;
  }
  if (请求.url === '/api/zones') {
    const zones = await 调用接口(数据.credentials, '/zones?status=active&per_page=100');
    返回JSON(响应, 200, { ok: true, zones: zones.map(区域 => ({ id: 区域.id, name: 区域.name })) });
    return;
  }
  if (请求.url === '/api/resources') {
    if (!数据.accountId) throw new Error('缺少 Account ID');
    const resources = await 读取资源列表(数据.credentials, 数据.accountId);
    返回JSON(响应, 200, { ok: true, ...resources });
    return;
  }
  if (请求.url === '/api/deploy') {
    const 结果 = await 部署(数据);
    返回JSON(响应, 200, { ok: true, ...结果 });
    return;
  }
  返回JSON(响应, 404, { ok: false, error: '接口不存在' });
}

async function 部署(数据) {
  数据 = await 补全部署默认值(数据);
  校验部署参数(数据);
  const 日志 = [];
  const 记录 = 文本 => 日志.push(`[${new Date().toLocaleTimeString()}] ${文本}`);
  const 操作模式 = 数据.deployMode === 'update' ? 'update' : 'create';
  const 原始项目名 = String(数据.projectName || '').trim();
  const 项目名 = 操作模式 === 'update' ? 原始项目名 : 清理项目名(原始项目名 || 生成随机名称('edge'));
  const 部署方式 = 数据.deployType === 'worker' ? 'worker' : 'pages';
  记录(`准备${操作模式 === 'update' ? '更新' : '部署'} ${部署方式 === 'pages' ? 'Pages' : 'Worker'}: ${项目名}`);
  记录(`部署源: ${部署源.label}，源文件: ${部署源.fileName}`);
  if (操作模式 === 'update') {
    if (部署方式 === 'worker') {
      await 同步Worker代码(数据.credentials, {
        accountId: 数据.accountId,
        scriptName: 项目名
      }, 记录);
    } else {
      await 同步Pages代码(数据.credentials, {
        accountId: 数据.accountId,
        projectName: 项目名
      }, 记录);
    }
    记录('更新模式只同步代码，未修改变量、KV、域名或项目配置');
    return { deployType: 部署方式, projectName: 项目名, admin: 数据.admin || '', logs: 日志 };
  }
  const 命名空间 = await 获取或创建KV(数据.credentials, 数据.accountId, {
    id: 数据.kvId,
    title: 数据.kvTitle || 生成随机名称('store')
  }, 记录);
  if (命名空间.created) {
    记录(`KV 已创建: ${命名空间.title}（${部署源.label} 无需预置，Worker 首次访问自动初始化）`);
  } else {
    记录('复用现有 KV，保留原配置');
  }
  if (部署方式 === 'worker') {
    await 部署Worker(数据.credentials, {
      accountId: 数据.accountId,
      scriptName: 项目名,
      部署数据: 数据,
      kvId: 命名空间.id,
      enableWorkersDev: !!数据.enableWorkersDev
    }, 记录);
  } else {
    await 部署Pages(数据.credentials, {
      accountId: 数据.accountId,
      projectName: 项目名,
      部署数据: 数据,
      kvId: 命名空间.id
    }, 记录);
  }
  let domain = null;
  if (数据.hostname && 数据.zoneId) {
    domain = await 绑定域名(数据.credentials, {
      accountId: 数据.accountId,
      deployType: 部署方式,
      projectName: 项目名,
      zoneId: 数据.zoneId,
      hostname: 数据.hostname
    }, 记录);
  }
  const domains = await 列出绑定域名(数据.credentials, {
    accountId: 数据.accountId,
    deployType: 部署方式,
    projectName: 项目名
  }, 记录);
  记录('部署完成');
  return {
    deployType: 部署方式,
    projectName: 项目名,
    admin: 数据.admin || '',
    uuid: 数据.uuid || '',
    kv: { id: 命名空间.id, title: 命名空间.title || 数据.kvTitle || '' },
    domain,
    domains,
    logs: 日志
  };
}

async function 补全部署默认值(数据) {
  if (!数据?.credentials?.email || !数据?.credentials?.key) return 数据;
  const 输出 = { ...数据 };
  let zones = null;
  if (!输出.accountId) {
    const accounts = await 调用接口(输出.credentials, '/accounts?per_page=50');
    if (!accounts.length) throw new Error('当前凭据没有可用账户');
    输出.accountId = accounts[0].id;
    输出.accountName = accounts[0].name;
  }
  if (!输出.deployType) 输出.deployType = 'pages';
  if (输出.deployMode === 'update') return 输出;
  if (输出.autoDomain && !输出.hostname) {
    zones = await 调用接口(输出.credentials, '/zones?status=active&per_page=100');
    if (zones.length) {
      输出.zoneId = 输出.zoneId || zones[0].id;
      输出.zoneName = zones[0].name;
      输出.hostname = `${生成随机名称('edge')}.${zones[0].name}`;
    }
  }
  if (输出.hostname && !输出.zoneId) {
    zones = zones || await 调用接口(输出.credentials, '/zones?status=active&per_page=100');
    const zone = zones
      .filter(区域 => 输出.hostname === 区域.name || 输出.hostname.endsWith(`.${区域.name}`))
      .sort((甲, 乙) => 乙.name.length - 甲.name.length)[0];
    if (!zone) throw new Error(`找不到匹配域名 ${输出.hostname} 的 Cloudflare Zone`);
    输出.zoneId = zone.id;
    输出.zoneName = zone.name;
  }
  if (输出.hostname && 输出.zoneId) {
    zones = zones || await 调用接口(输出.credentials, '/zones?status=active&per_page=100');
    const zone = zones.find(区域 => 区域.id === 输出.zoneId) || (输出.zoneName ? { id: 输出.zoneId, name: 输出.zoneName } : null);
    if (zone && 输出.hostname === zone.name) {
      输出.hostname = `${生成随机名称('edge')}.${zone.name}`;
      输出.zoneName = zone.name;
    }
  }
  return 输出;
}

async function 读取资源列表(凭据, accountId) {
  const [workerResult, pagesResult, kvResult] = await Promise.allSettled([
    调用接口(凭据, `/accounts/${accountId}/workers/scripts?per_page=100`),
    读取Pages项目列表(凭据, accountId),
    调用接口(凭据, `/accounts/${accountId}/storage/kv/namespaces?per_page=100`)
  ]);
  const warnings = [];
  const workers = 提取列表(workerResult, warnings, 'Worker')
    .map(项目 => ({ name: 项目.id || 项目.script_name || 项目.name, title: 项目.id || 项目.script_name || 项目.name }))
    .filter(项目 => 项目.name);
  const pages = 提取列表(pagesResult, warnings, 'Pages')
    .map(项目 => ({
      name: 项目.name,
      title: 项目.name,
      kvId: 提取PagesKV(项目),
      domains: 项目.domains || []
    }))
    .filter(项目 => 项目.name);
  const kvs = 提取列表(kvResult, warnings, 'KV')
    .map(空间 => ({ id: 空间.id, title: 空间.title }))
    .filter(空间 => 空间.id);
  return { workers, pages, kvs, warnings };
}

function 提取PagesKV(项目) {
  const 配置 = 项目?.deployment_configs || {};
  for (const 环境 of ['production', 'preview']) {
    const 命名空间 = 配置[环境]?.kv_namespaces || {};
    const 绑定 = 命名空间['KV'] || Object.values(命名空间)[0];
    if (绑定?.namespace_id) return 绑定.namespace_id;
    if (typeof 绑定 === 'string') return 绑定;
  }
  return '';
}

async function 读取Pages项目列表(凭据, accountId) {
  try {
    return await 调用接口(凭据, `/accounts/${accountId}/pages/projects`);
  } catch (错误) {
    if (!String(错误.message || '').includes('Invalid list options')) throw 错误;
    return await 调用接口(凭据, `/accounts/${accountId}/pages/projects?page=1`);
  }
}

function 提取列表(result, warnings, label) {
  if (result.status === 'fulfilled') return Array.isArray(result.value) ? result.value : [];
  warnings.push(`${label} 列表读取失败: ${result.reason?.message || result.reason}`);
  return [];
}

function 校验部署参数(数据) {
  if (!数据?.credentials?.email || !数据?.credentials?.key) throw new Error('缺少 Cloudflare 邮箱或 Global API Key');
  if (!数据.accountId) throw new Error('缺少 Account ID');
  if (数据.deployMode === 'update' && !String(数据.projectName || '').trim()) throw new Error('更新现有项目时必须选择项目名称');
  if (数据.deployMode === 'update') return;
  if (!String(数据.admin || '').trim()) throw new Error('必须填写 ADMIN（后台管理密码）');
  if (数据.hostname && !数据.zoneId) throw new Error('绑定域名时必须选择 Zone');
}

function 构建变量(数据) {
  const 变量 = [];
  const 添加 = (名称, 值) => {
    const 文本 = String(值 ?? '').trim();
    if (文本) 变量.push({ type: 'plain_text', name: 名称, text: 文本 });
  };
  添加('ADMIN', 数据.admin);
  添加('KEY', 数据.key);
  添加('UUID', 数据.uuid);
  添加('PROXYIP', 数据.proxyip);
  添加('URL', 数据.url);
  添加('GO2SOCKS5', 数据.go2socks5);
  添加('DEBUG', 数据.debug);
  添加('OFF_LOG', 数据.offlog);
  添加('BEST_SUB', 数据.bestsub);
  添加('PRELOAD_RACE_DIAL', 数据.preload);
  添加('TCP_CONCURRENT_DIAL', 数据.tcpConcurrent);
  添加('PROXY_CONCURRENT_DIAL', 数据.proxyConcurrent);
  return 变量;
}

async function 部署Worker(凭据, 选项, 记录) {
  const 代码 = await 读取源代码();
  const 变量 = 构建变量(选项.部署数据);
  const 元数据 = {
    main_module: 部署源.mainModule,
    compatibility_date: 部署源.compatibilityDate,
    bindings: [
      ...变量,
      { type: 'kv_namespace', name: 部署源.kvBinding, namespace_id: 选项.kvId }
    ]
  };
  const 表单 = new FormData();
  表单.append('metadata', new Blob([JSON.stringify(元数据)], { type: 'application/json' }), 'metadata.json');
  表单.append(部署源.mainModule, new Blob([代码], { type: 'application/javascript+module' }), 部署源.mainModule);
  await 调用接口(凭据, `/accounts/${选项.accountId}/workers/scripts/${encodeURIComponent(选项.scriptName)}`, {
    method: 'PUT',
    body: 表单
  });
  记录(`Worker 脚本上传完成（变量: ${变量.map(项 => 项.name).join(', ') || '无'}，KV 绑定: ${部署源.kvBinding}）`);
  if (选项.enableWorkersDev) {
    await 启用WorkersDev(凭据, 选项.accountId, 选项.scriptName);
    记录('workers.dev 默认域名已启用');
  }
}

async function 同步Worker代码(凭据, 选项, 记录) {
  const 代码 = await 读取源代码();
  const 设置 = await 读取Worker设置(凭据, 选项.accountId, 选项.scriptName);
  const 元数据 = 生成保留Worker元数据(设置);
  const 表单 = new FormData();
  表单.append('metadata', new Blob([JSON.stringify(元数据)], { type: 'application/json' }), 'metadata.json');
  const 模块名 = 元数据.main_module || 部署源.mainModule;
  表单.append(模块名, new Blob([代码], { type: 'application/javascript+module' }), 模块名);
  await 调用接口(凭据, `/accounts/${选项.accountId}/workers/scripts/${encodeURIComponent(选项.scriptName)}`, {
    method: 'PUT',
    body: 表单
  });
  记录('Worker 代码已同步，现有绑定和设置按原值提交');
}

async function 读取Worker设置(凭据, accountId, scriptName) {
  try {
    return await 调用接口(凭据, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/settings`);
  } catch (错误) {
    throw new Error(`读取现有 Worker 设置失败，已停止更新以避免覆盖变量/KV 配置: ${错误.message}`);
  }
}

function 生成保留Worker元数据(设置) {
  const 元数据 = {};
  for (const 字段 of [
    'main_module',
    'compatibility_date',
    'compatibility_flags',
    'bindings',
    'migrations',
    'usage_model',
    'limits',
    'placement',
    'tail_consumers',
    'logpush'
  ]) {
    if (设置?.[字段] !== undefined && 设置?.[字段] !== null) 元数据[字段] = 设置[字段];
  }
  if (!元数据.main_module) 元数据.main_module = '_worker.js';
  if (!元数据.compatibility_date) {
    throw new Error('无法读取现有 Worker compatibility_date，已停止更新以避免修改配置');
  }
  if (!Array.isArray(元数据.bindings)) {
    throw new Error('无法读取现有 Worker 绑定，已停止更新以避免覆盖变量/KV 配置');
  }
  return 元数据;
}

async function 部署Pages(凭据, 选项, 记录) {
  const 项目 = await 创建或更新Pages项目(凭据, 选项, 记录);
  const 代码 = await 读取源代码();
  记录(`Pages 项目已配置: ${项目.name}`);
  await 上传Pages部署(凭据, 选项.accountId, 选项.projectName, 代码, 记录);
  记录('Pages 部署上传完成');
}

async function 同步Pages代码(凭据, 选项, 记录) {
  try {
    await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects/${encodeURIComponent(选项.projectName)}`);
  } catch (错误) {
    if (String(错误.message).includes('404')) throw new Error(`找不到现有 Pages 项目: ${选项.projectName}`);
    throw 错误;
  }
  const 代码 = await 读取源代码();
  记录('Pages 更新模式不修改变量/KV/域名配置');
  await 上传Pages部署(凭据, 选项.accountId, 选项.projectName, 代码, 记录);
  记录('Pages 代码同步完成');
}

async function 上传Pages部署(凭据, accountId, projectName, workerCode, 记录) {
  const manifest = await 上传Pages静态资源(凭据, accountId, projectName, 记录);
  const 表单 = new FormData();
  表单.append('manifest', JSON.stringify(manifest));
  表单.append('branch', 'main');
  表单.append('commit_dirty', 'true');
  表单.append('commit_message', 'deploy from deployer');
  const workerBundle = await 生成WorkerBundle(workerCode);
  表单.append('_worker.bundle', workerBundle, '_worker.bundle');
  const deployment = await 重试Notfound(() =>
    调用接口(凭据, `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`, {
      method: 'POST',
      body: 表单
    }), 记录, '上传 Pages 部署');
  if (deployment?.url) 记录(`Pages 地址: ${deployment.url}`);
}

async function 上传Pages静态资源(凭据, accountId, projectName, 记录) {
  const { jwt } = await 重试Notfound(() =>
    调用接口(凭据, `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/upload-token`),
    记录, '获取 Pages 上传令牌');
  const 内容 = '<!doctype html><meta charset="utf-8"><title>Deploy</title>';
  const 字节 = new TextEncoder().encode(内容);
  const hash = await 计算资源Hash(字节, 'html');
  const missing = await 调用JWT接口(jwt, '/pages/assets/check-missing', {
    method: 'POST',
    body: { hashes: [hash] }
  });
  if (!Array.isArray(missing) || missing.includes(hash)) {
    await 调用JWT接口(jwt, '/pages/assets/upload', {
      method: 'POST',
      body: [{
        key: hash,
        value: 字节转Base64(字节),
        metadata: { contentType: 'text/html; charset=utf-8' },
        base64: true
      }]
    });
  }
  await 调用JWT接口(jwt, '/pages/assets/upsert-hashes', {
    method: 'POST',
    body: { hashes: [hash] }
  }).catch(() => null);
  return { '/index.html': hash };
}

async function 生成WorkerBundle(workerCode) {
  const 内层 = new FormData();
  const 元数据 = {
    main_module: 部署源.mainModule,
    compatibility_date: 部署源.compatibilityDate
  };
  内层.set('metadata', JSON.stringify(元数据));
  内层.set(部署源.mainModule, new Blob([workerCode], { type: 'application/javascript+module' }), 部署源.mainModule);
  return await new Response(内层).blob();
}

async function 调用JWT接口(jwt, 路径, 选项 = {}) {
  const headers = {
    Authorization: `Bearer ${jwt}`,
    ...(选项.headers || {})
  };
  let body = 选项.body;
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(body);
  }
  const 响应 = await fetch(`${接口地址}${路径}`, { method: 选项.method || 'GET', headers, body });
  const contentType = 响应.headers.get('content-type') || '';
  const 响应体 = contentType.includes('application/json') ? await 响应.json() : await 响应.text();
  if (!响应.ok) {
    const 消息 = typeof 响应体 === 'string'
      ? 响应体
      : (响应体.errors || []).map(错误 => 错误.message || JSON.stringify(错误)).join('; ');
    throw new Error(`${响应.status} ${响应.statusText}${消息 ? ` - ${消息}` : ''}`);
  }
  return 响应体;
}

// Pages 项目创建后立即上传可能遇到 Cloudflare 传播延迟导致 404，自动重试
async function 重试Notfound(fn, 记录, 标签, 次数 = 3) {
  for (let i = 1; i <= 次数; i++) {
    try {
      return await fn();
    } catch (错误) {
      const 消息 = String(错误.message || '');
      const 是404 = 消息.includes('404') && /not found|不存在|no match/i.test(消息);
      if (i === 次数 || !是404) throw 错误;
      记录(`${标签} 暂不可见，${i} 秒后重试(${i}/${次数})…`);
      await 等待(i * 800);
    }
  }
}

function 等待(毫秒) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, 毫秒));
}

async function 计算资源Hash(bytes, extension) {
  const 摘要 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${字节转Base64(bytes)}${extension}`));
  return [...new Uint8Array(摘要)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function 字节转Base64(bytes) {
  let 二进制 = '';
  const 步长 = 0x8000;
  for (let index = 0; index < bytes.length; index += 步长) {
    二进制 += String.fromCharCode(...bytes.slice(index, index + 步长));
  }
  return btoa(二进制);
}

async function 创建或更新Pages项目(凭据, 选项, 记录) {
  let 项目 = null;
  try {
    项目 = await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects/${encodeURIComponent(选项.projectName)}`);
  } catch (错误) {
    if (!String(错误.message).includes('404')) throw 错误;
  }
  if (!项目) {
    项目 = await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects`, {
      method: 'POST',
      body: {
        name: 选项.projectName,
        production_branch: 'main',
        deployment_configs: 生成Pages配置(选项)
      }
    });
    记录('Pages 项目已创建');
    return 项目;
  }
  await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects/${encodeURIComponent(选项.projectName)}`, {
    method: 'PATCH',
    body: {
      deployment_configs: 合并Pages配置(项目.deployment_configs || {}, 选项)
    }
  });
  记录('Pages 项目配置已更新');
  return 项目;
}

function 生成Pages配置(选项) {
  const 变量 = 构建变量(选项.部署数据);
  const 单项 = {
    compatibility_date: 部署源.compatibilityDate,
    env_vars: 变量转Pages环境变量(变量),
    kv_namespaces: { [部署源.kvBinding]: { namespace_id: 选项.kvId } }
  };
  return { production: 单项, preview: 单项 };
}

function 变量转Pages环境变量(变量) {
  const 结果 = {};
  for (const 项 of 变量) 结果[项.name] = { type: 'plain_text', value: 项.text };
  return 结果;
}

function 合并Pages配置(已有, 选项) {
  const 输出 = structuredClone(已有 || {});
  const 变量 = 构建变量(选项.部署数据);
  for (const 名称 of ['production', 'preview']) {
    输出[名称] = 输出[名称] || {};
    输出[名称].compatibility_date = 部署源.compatibilityDate;
    输出[名称].env_vars = 输出[名称].env_vars || {};
    for (const 项 of 变量) 输出[名称].env_vars[项.name] = { type: 'plain_text', value: 项.text };
    输出[名称].kv_namespaces = 输出[名称].kv_namespaces || {};
    输出[名称].kv_namespaces[部署源.kvBinding] = { namespace_id: 选项.kvId };
  }
  return 输出;
}

async function 获取或创建KV(凭据, accountId, 选项, 记录) {
  const 列表 = await 调用接口(凭据, `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
  if (选项.id) {
    const 已选 = 列表.find(项 => 项.id === 选项.id);
    if (已选) {
      记录(`复用 KV: ${已选.title}`);
      return { ...已选, created: false };
    }
    记录(`使用指定 KV: ${选项.id}`);
    return { id: 选项.id, title: 选项.title || 选项.id, created: false };
  }
  const 标题 = 选项.title;
  const 已有 = 列表.find(项 => 项.title === 标题);
  if (已有) {
    记录(`复用 KV: ${标题}`);
    return { ...已有, created: false };
  }
  const 创建结果 = await 调用接口(凭据, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: 'POST',
    body: { title: 标题 }
  });
  记录(`创建 KV: ${标题}`);
  return { ...创建结果, title: 标题, created: true };
}

async function 启用WorkersDev(凭据, accountId, scriptName) {
  const 路径 = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`;
  try {
    await 调用接口(凭据, 路径, { method: 'POST', body: { enabled: true } });
  } catch {
    await 调用接口(凭据, 路径, { method: 'PUT', body: { enabled: true } });
  }
}

async function 绑定域名(凭据, 选项, 记录) {
  if (选项.deployType === 'pages') {
    const 结果 = await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects/${encodeURIComponent(选项.projectName)}/domains`, {
      method: 'POST',
      body: { name: 选项.hostname }
    });
    记录(`Pages 域名已绑定: ${选项.hostname}`);
    // 自动创建 CNAME 记录指向 Pages 项目，同账号域名可自动通过验证
    try {
      await 调用接口(凭据, `/zones/${选项.zoneId}/dns_records`, {
        method: 'POST',
        body: { type: 'CNAME', name: 选项.hostname, content: `${选项.projectName}.pages.dev`, proxied: true }
      });
      记录(`CNAME 记录已创建: ${选项.hostname} → ${选项.projectName}.pages.dev`);
    } catch (dns错误) {
      记录(`CNAME 记录创建跳过(可能已存在): ${dns错误.message}`);
    }
    return { hostname: 结果.name || 选项.hostname, type: 'pages' };
  }
  const 请求体 = {
    environment: 'production',
    hostname: 选项.hostname,
    service: 选项.projectName,
    zone_id: 选项.zoneId
  };
  try {
    const 结果 = await 调用接口(凭据, `/accounts/${选项.accountId}/workers/domains`, {
      method: 'PUT',
      body: 请求体
    });
    记录(`Worker 自定义域名已绑定: ${选项.hostname}`);
    return { hostname: 结果.hostname || 选项.hostname, type: 'worker' };
  } catch (错误) {
    await 调用接口(凭据, `/zones/${选项.zoneId}/workers/routes`, {
      method: 'POST',
      body: { pattern: `${选项.hostname}/*`, script: 选项.projectName }
    });
    记录(`Worker Route 已绑定: ${选项.hostname}/*`);
    return { hostname: 选项.hostname, type: 'route', warning: 错误.message };
  }
}

async function 列出绑定域名(凭据, 选项, 记录) {
  try {
    if (选项.deployType === 'pages') {
      const 列表 = await 调用接口(凭据, `/accounts/${选项.accountId}/pages/projects/${encodeURIComponent(选项.projectName)}/domains`);
      return 列表.map(项 => ({ hostname: 项.name || 项.hostname, status: 项.status || '' }));
    }
    const 列表 = await 调用接口(凭据, `/accounts/${选项.accountId}/workers/domains?per_page=100`);
    return 列表
      .filter(项 => 项.service === 选项.projectName || 项.script === 选项.projectName)
      .map(项 => ({ hostname: 项.hostname || 项.domain, status: 项.status || '' }));
  } catch (错误) {
    记录(`域名列表读取失败: ${错误.message}`);
    return [];
  }
}

async function 读取源代码() {
  const 地址 = `${部署源.repoBase}/${encodeURIComponent(部署源.fileName)}?t=${Date.now()}`;
  try {
    const 响应 = await fetch(地址, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
    if (!响应.ok) throw new Error(`${响应.status} ${响应.statusText}`);
    const 内容 = await 响应.text();
    if (!内容.trim()) throw new Error('远程源文件为空');
    return 内容;
  } catch (错误) {
    try {
      return await readFile(join(源码目录, 部署源.fileName), 'utf8');
    } catch {
      throw new Error(`实时拉取源文件失败: ${错误.message}`);
    }
  }
}

async function 调用接口(凭据, 路径, 选项 = {}) {
  const 响应体 = await 调用原始接口(凭据, 路径, 选项);
  if (响应体 && typeof 响应体 === 'object' && 'success' in 响应体) {
    if (!响应体.success) {
      const 消息 = (响应体.errors || []).map(错误 => 错误.message || JSON.stringify(错误)).join('; ') || 'Cloudflare API 请求失败';
      const 异常 = new Error(消息);
      异常.response = 响应体;
      throw 异常;
    }
    return 响应体.result;
  }
  return 响应体;
}

async function 调用原始接口(凭据, 路径, 选项 = {}) {
  const 地址 = 路径.startsWith('http') ? 路径 : `${接口地址}${路径}`;
  const headers = {
    'X-Auth-Email': 凭据.email,
    'X-Auth-Key': 凭据.key,
    ...(选项.headers || {})
  };
  let body = 选项.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(body);
  }
  const 响应 = await fetch(地址, {
    method: 选项.method || 'GET',
    headers,
    body
  });
  const contentType = 响应.headers.get('content-type') || '';
  const 响应体 = contentType.includes('application/json') ? await 响应.json() : await 响应.text();
  if (!响应.ok) {
    const 消息 = typeof 响应体 === 'string'
      ? 响应体
      : (响应体.errors || []).map(错误 => 错误.message || JSON.stringify(错误)).join('; ');
    throw new Error(`${响应.status} ${响应.statusText}${消息 ? ` - ${消息}` : ''}`);
  }
  return 响应体;
}

async function 读取JSON(请求) {
  let 内容 = '';
  for await (const 块 of 请求) 内容 += 块;
  return 内容 ? JSON.parse(内容) : {};
}

async function 处理静态文件(请求, 响应) {
  const 地址 = new URL(请求.url, 'http://localhost');
  const pathname = decodeURIComponent(地址.pathname === '/' ? '/index.html' : 地址.pathname);
  const 文件路径 = resolve(静态目录, `.${pathname}`);
  if (!文件路径.startsWith(静态目录) || !existsSync(文件路径)) {
    响应.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    响应.end('Not Found');
    return;
  }
  const 类型 = 获取类型(文件路径);
  响应.writeHead(200, { 'Content-Type': 类型 });
  响应.end(await readFile(文件路径));
}

function 返回JSON(响应, 状态码, 数据) {
  响应.writeHead(状态码, { 'Content-Type': 'application/json; charset=utf-8' });
  响应.end(JSON.stringify(数据));
}

function 获取类型(文件路径) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  }[extname(文件路径)] || 'application/octet-stream';
}

function 清理项目名(名称) {
  return String(名称 || 生成随机名称('edge')).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 生成随机名称('edge');
}

function 生成随机名称(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
