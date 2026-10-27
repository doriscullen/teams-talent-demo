/* CardDemo Web UI —— 无框架单页应用，仅依赖浏览器原生能力。 */
'use strict';

const AUTH_KEY = 'carddemo.session';
const state = { session: null };

const appEl = () => document.getElementById('app');
const toastRoot = () => document.getElementById('toasts');

/* ---------------- 基础工具 ---------------- */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const money = (value) => value === null || value === undefined || value === ''
    ? '—'
    : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateText = (value) => (value ? String(value).slice(0, 10) : '—');

const dateTimeText = (value) => (value ? String(value).replace('T', ' ').slice(0, 19) : '—');

const statusBadge = (value) => (value === 'Y'
    ? '<span class="badge ok">正常</span>'
    : '<span class="badge bad">停用</span>');

const userTypeBadge = (value) => (value === 'A'
    ? '<span class="badge warn">管理员</span>'
    : '<span class="badge neutral">普通用户</span>');

const authBadge = (code) => (code === '00'
    ? '<span class="badge ok">批准</span>'
    : '<span class="badge bad">拒绝</span>');

function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastRoot().appendChild(el);
    setTimeout(() => el.remove(), 4500);
}

function errBox(err) {
    const details = err && err.details && err.details.length
        ? `<ul>${err.details.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
        : '';
    return `<div class="alert error"><strong>${esc((err && err.code) || '请求失败')}</strong>`
        + `${err && err.message ? ` · ${esc(err.message)}` : ''}${details}</div>`;
}

function setBusy(button, busy, label = '处理中…') {
    if (!button) return;
    if (busy) {
        button.dataset.label = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
    } else {
        button.disabled = false;
        if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
}

function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}

/* ---------------- 会话与 API ---------------- */

function loadSession() {
    try {
        state.session = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
    } catch (ignored) {
        state.session = null;
    }
}

function saveSession(session) {
    state.session = session;
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

function clearSession() {
    state.session = null;
    sessionStorage.removeItem(AUTH_KEY);
}

async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.session && state.session.token) headers['Authorization'] = `Bearer ${state.session.token}`;

    const response = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (ignored) {
            data = { message: text };
        }
    }

    if (!response.ok) {
        const error = new Error((data && (data.message || data.error)) || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        error.code = data && data.code;
        error.details = (data && data.details) || [];
        if (response.status === 401 && state.session) {
            clearSession();
            location.hash = '#/login';
            toast('登录已失效，请重新登录', 'error');
        }
        throw error;
    }
    return data;
}

/* ---------------- 布局 ---------------- */

const NAV_GROUPS = [
    {
        title: '业务',
        items: [
            { key: 'menu', href: '#/menu', icon: '🏠', label: '首页' },
            { key: 'accounts', href: '#/accounts', icon: '🧾', label: '账户视图' },
            { key: 'cards', href: '#/cards', icon: '💳', label: '信用卡' },
            { key: 'transactions', href: '#/transactions', icon: '📄', label: '交易查询' },
            { key: 'transaction-new', href: '#/transactions/new', icon: '➕', label: '交易录入' },
            { key: 'installments', href: '#/installments', icon: '🧮', label: '我的分期' },
            { key: 'bill-pay', href: '#/bill-pay', icon: '💸', label: '账单支付' },
            { key: 'reports', href: '#/reports', icon: '📊', label: '交易报表' },
            { key: 'authorizations', href: '#/authorizations', icon: '🛡️', label: '授权管理' }
        ]
    },
    {
        title: '营销',
        items: [
            { key: 'offers', href: '#/offers', icon: '🎁', label: '活动中心' },
            { key: 'rewards', href: '#/rewards', icon: '💰', label: '我的奖励' }
        ]
    },
    {
        title: '管理',
        adminOnly: true,
        items: [
            { key: 'users', href: '#/users', icon: '👥', label: '用户管理' },
            { key: 'admin-installments', href: '#/admin/installments', icon: '📑', label: '分期后台' },
            { key: 'campaigns', href: '#/campaigns', icon: '📣', label: '活动管理' }
        ]
    }
];

function visibleNavGroups() {
    const isAdmin = state.session && state.session.user && state.session.user.userType === 'A';
    return NAV_GROUPS
        .filter((group) => !group.adminOnly || isAdmin)
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => !item.adminOnly || isAdmin)
        }));
}

function shell({ active, title, subtitle, content }) {
    const user = state.session ? state.session.user : null;
    const initials = user ? `${(user.firstName || '?').slice(0, 1)}${(user.lastName || '').slice(0, 1)}` : '?';
    const nav = visibleNavGroups().map((group) => `
        <div class="nav-group-title">${esc(group.title)}</div>
        <div class="nav">
            ${group.items.map((item) => `
                <a href="${item.href}" class="${active === item.key ? 'active' : ''}">
                    <span class="ico">${item.icon}</span>${esc(item.label)}
                </a>`).join('')}
        </div>`).join('');

    appEl().innerHTML = `
        <div class="shell">
            <aside class="sidebar">
                <div class="brand">
                    <span class="dot"></span>
                    <div>CardDemo<small>信用卡核心系统</small></div>
                </div>
                ${nav}
                <div class="sidebar-foot">演示环境 · 数据为种子样例<br>CardDemo Java 微服务版</div>
            </aside>
            <main class="main">
                <div class="topbar">
                    <div>
                        <h2>${esc(title || '')}</h2>
                        <div class="sub">${esc(subtitle || '')}</div>
                    </div>
                    <div class="user-chip">
                        <div class="avatar">${esc(initials.toUpperCase())}</div>
                        <div>
                            <div><strong>${esc(user ? `${user.firstName} ${user.lastName}` : '')}</strong></div>
                            <div class="muted" style="font-size:11.5px">${esc(user ? user.userId : '')}
                                · ${user && user.userType === 'A' ? '管理员' : '普通用户'}</div>
                        </div>
                        <button class="btn ghost small" data-action="logout">退出</button>
                    </div>
                </div>
                <div class="content">${content}</div>
            </main>
        </div>`;

    const logout = document.querySelector('[data-action="logout"]');
    if (logout) {
        logout.addEventListener('click', () => {
            clearSession();
            location.hash = '#/login';
            toast('已退出登录');
        });
    }
}

function pager(page, size, total, action = 'page') {
    const pages = Math.max(1, Math.ceil((total || 0) / size));
    return `
        <div class="pager">
            <span class="info">共 ${total} 条 · 第 ${Math.min(page + 1, pages)}/${pages} 页</span>
            <button type="button" class="btn ghost small" data-${action}="prev" ${page <= 0 ? 'disabled' : ''}>上一页</button>
            <button type="button" class="btn ghost small" data-${action}="next" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button>
        </div>`;
}

/* ---------------- 页面：登录 ---------------- */

function pageLogin() {
    appEl().innerHTML = `
        <div class="login-wrap">
            <div class="login-card">
                <div class="login-brand">
                    <div class="mark">CD</div>
                    <div>
                        <h1>CardDemo 信用卡核心系统</h1>
                        <p>登录后进入账户、卡片、交易与授权管理</p>
                    </div>
                </div>
                <form id="login-form">
                    <div class="form-grid">
                        <label class="field">
                            <span>用户号</span>
                            <input id="login-user" name="userId" value="ADMIN001" maxlength="8"
                                   autocomplete="username" required>
                        </label>
                        <label class="field">
                            <span>密码</span>
                            <input id="login-pass" name="password" type="password" value="admin123"
                                   maxlength="64" autocomplete="current-password" required>
                        </label>
                    </div>
                    <div class="mt-16">
                        <button class="btn primary" type="submit" id="login-btn">登录</button>
                    </div>
                    <div id="login-error"></div>
                </form>
                <div class="demo-accounts">
                    <button type="button" class="chip" data-demo="admin">管理员 ADMIN001 / admin123</button>
                    <button type="button" class="chip" data-demo="user">用户 USER0001 / user1234</button>
                </div>
                <div class="login-foot">
                    演示账号已预填，可直接登录。管理员可额外访问“用户管理”。
                    本环境为 POC，接口尚未强制校验 token，请勿暴露到公网。
                </div>
            </div>
        </div>`;

    document.querySelectorAll('[data-demo]').forEach((chip) => {
        chip.addEventListener('click', () => {
            const admin = chip.dataset.demo === 'admin';
            document.getElementById('login-user').value = admin ? 'ADMIN001' : 'USER0001';
            document.getElementById('login-pass').value = admin ? 'admin123' : 'user1234';
            document.getElementById('login-error').innerHTML = '';
        });
    });

    const form = document.getElementById('login-form');
    const button = document.getElementById('login-btn');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const errorBox = document.getElementById('login-error');
        errorBox.innerHTML = '';
        setBusy(button, true, '登录中…');
        try {
            const result = await api('/api/v1/auth/login', {
                method: 'POST',
                body: { userId: values.userId.trim(), password: values.password }
            });
            saveSession({ token: result.token, expiresAt: result.expiresAt, user: result.user });
            toast(`欢迎，${result.user.firstName}（${result.user.landingMenu === 'ADMIN' ? '管理员' : '普通用户'}）`, 'success');
            location.hash = '#/menu';
        } catch (error) {
            errorBox.innerHTML = errBox(error);
            setBusy(button, false);
        }
    });
}

/* ---------------- 页面：首页 ---------------- */

function pageMenu() {
    const user = state.session.user;
    const isAdmin = user.userType === 'A';
    const features = [
        { href: '#/accounts', icon: '🧾', title: '账户视图', text: '余额、额度、账期与客户资料一屏查看' },
        { href: '#/cards', icon: '💳', title: '信用卡管理', text: '按账户查询卡片、查看详情与维护卡状态' },
        { href: '#/transactions', icon: '📄', title: '交易查询', text: '按交易号/卡号/账户检索交易明细' },
        { href: '#/transactions/new', icon: '➕', title: '交易录入', text: '人工补录交易，支持类型与类别选择' },
        { href: '#/installments', icon: '🧮', title: '我的分期', text: '消费/账单分期试算、提交、还款计划与提前结清' },
        { href: '#/bill-pay', icon: '💸', title: '账单支付', text: '全额还款，实时更新账户余额' },
        { href: '#/reports', icon: '📊', title: '交易报表', text: '按日期区间生成交易明细与合计' },
        { href: '#/authorizations', icon: '🛡️', title: '授权管理', text: '待授权汇总、明细与欺诈标记' },
        { href: '#/offers', icon: '🎁', title: '活动中心', text: '查看可参与的营销活动并报名' },
        { href: '#/rewards', icon: '💰', title: '我的奖励', text: '返现与积分记录，失败可重试' },
        ...(isAdmin ? [{ href: '#/campaigns', icon: '📣', title: '活动管理', text: '新建活动、发布、暂停与效果分析' }] : []),
        ...(isAdmin ? [{ href: '#/users', icon: '👥', title: '用户管理', text: '维护登录用户与管理员账号' }] : [])
    ];

    shell({
        active: 'menu',
        title: `欢迎，${user.firstName}`,
        subtitle: `当前身份：${isAdmin ? '管理员' : '普通用户'} · ${user.userId}`,
        content: `
            <div class="card mb-16">
                <h3>今天的演示可以做什么</h3>
                <p class="muted" style="margin:0">
                    本界面连接 6 个微服务（IAM、客户、卡片、账户、交易、授权），全部数据来自遗留 COBOL 系统的归一化种子。
                    可以先看账户 00000000001（额度 2020、欠款 1940、可用 80），再试一笔账单支付或授权。
                </p>
            </div>
            <div class="grid cols-3">
                ${features.map((feature) => `
                    <a class="feature" href="${feature.href}">
                        <div class="icon">${feature.icon}</div>
                        <h4>${esc(feature.title)}</h4>
                        <p>${esc(feature.text)}</p>
                    </a>`).join('')}
            </div>`
    });
}

/* ---------------- 页面：账户视图 ---------------- */

function pageAccounts() {
    shell({
        active: 'accounts',
        title: '账户视图',
        subtitle: '账户 + 客户 + 卡片组合视图（对应遗留 COACTVWC）',
        content: `
            <div class="card">
                <form class="inline-form" id="acct-form">
                    <label class="field grow">
                        <span>账户号（11 位）</span>
                        <input id="acct-id" name="accountId" value="00000000001" maxlength="11"
                               pattern="\\d{11}" required>
                    </label>
                    <button class="btn primary" type="submit">查询</button>
                </form>
                <div id="acct-result"></div>
            </div>`
    });

    const form = document.getElementById('acct-form');
    const box = document.getElementById('acct-result');
    const run = async (accountId) => {
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const account = await api(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
            const cards = ((await api(`/api/v1/cards/by-account/${encodeURIComponent(accountId)}`)).items) || [];
            let customer = null;
            if (cards.length > 0) {
                customer = await api(`/api/v1/customers/${encodeURIComponent(cards[0].customerId)}`)
                    .catch(() => null);
            }
            const available = Number(account.creditLimit) - Number(account.currentBalance);
            box.innerHTML = `
                <div class="grid cols-3 mt-16">
                    <div class="card">
                        <h3>账户 <span class="muted">${esc(account.accountId)}</span></h3>
                        <dl class="dl">
                            <dt>状态</dt><dd>${statusBadge(account.activeStatus)}</dd>
                            <dt>当前欠款余额</dt><dd class="mono">${money(account.currentBalance)}</dd>
                            <dt>信用额度</dt><dd class="mono">${money(account.creditLimit)}</dd>
                            <dt>可用额度</dt><dd class="mono"><strong>${money(available)}</strong></dd>
                            <dt>现金额度</dt><dd class="mono">${money(account.cashCreditLimit)}</dd>
                            <dt>本期贷 / 借</dt><dd class="mono">${money(account.currentCycleCredit)} / ${money(account.currentCycleDebit)}</dd>
                            <dt>开户 / 到期</dt><dd>${dateText(account.openDate)} / ${dateText(account.expirationDate)}</dd>
                            <dt>重发日</dt><dd>${dateText(account.reissueDate)}</dd>
                            <dt>账户组</dt><dd class="mono">${esc(account.groupId || '—')}</dd>
                        </dl>
                        <div class="hint mt-16">可用额度 = 信用额度 − 当前欠款（授权时还会扣除待授权占用）。</div>
                    </div>
                    <div class="card">
                        <h3>客户</h3>
                        ${customer ? `
                            <dl class="dl">
                                <dt>客户号</dt><dd class="mono">${esc(customer.customerId)}</dd>
                                <dt>姓名</dt><dd>${esc(customer.firstName)} ${esc(customer.middleName || '')} ${esc(customer.lastName)}</dd>
                                <dt>地址</dt><dd>${esc(customer.addressLine1)}<br>${esc(customer.addressLine2 || '')}<br>${esc(customer.addressLine3)}</dd>
                                <dt>州 / 邮编</dt><dd>${esc(customer.stateCode)} / ${esc(customer.zipCode)}</dd>
                                <dt>电话</dt><dd>${esc(customer.phoneNumber1 || '—')}</dd>
                                <dt>SSN</dt><dd class="mono">${esc(customer.ssnMasked)}</dd>
                                <dt>出生日期</dt><dd>${dateText(customer.dateOfBirth)}</dd>
                                <dt>FICO</dt><dd>${esc(customer.ficoScore)}</dd>
                                <dt>主卡持有人</dt><dd>${customer.primaryCardHolder === 'Y' ? '是' : '否'}</dd>
                            </dl>`
                        : '<div class="empty">该账户暂无关联客户（未找到卡片映射）</div>'}
                    </div>
                    <div class="card">
                        <h3>可用额度</h3>
                        <div class="stat" style="box-shadow:none;border:none;padding:0">
                            <div class="label">CREDIT AVAILABLE</div>
                            <div class="value">${money(available)}<small>CNY</small></div>
                        </div>
                        <div class="hint mt-16">
                            欠款 ${money(account.currentBalance)} / 额度 ${money(account.creditLimit)}<br>
                            卡片 ${cards.length} 张
                        </div>
                    </div>
                </div>
                <div class="card mt-16">
                    <div class="section-title"><h3>关联卡片</h3>
                        <a class="btn ghost small" href="#/cards">前往卡片管理</a></div>
                    ${cards.length === 0 ? '<div class="empty">暂无卡片</div>' : `
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>卡号</th><th>卡面姓名</th><th>到期日</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>${cards.map((card) => `
                            <tr>
                                <td class="mono">${esc(card.cardNumber)}</td>
                                <td>${esc(card.embossedName)}</td>
                                <td>${dateText(card.expiryDate)}</td>
                                <td>${statusBadge(card.activeStatus)}</td>
                                <td><a class="btn ghost small" href="#/cards/${encodeURIComponent(card.cardNumber)}">详情 / 维护</a></td>
                            </tr>`).join('')}
                        </tbody>
                    </table></div>`}
                </div>`;
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        run(document.getElementById('acct-id').value.trim());
    });
    run('00000000001');
}

/* ---------------- 页面：卡片列表 ---------------- */

const cardsUi = { accountId: '00000000001', customerId: '', page: 0 };

function pageCards() {
    shell({
        active: 'cards',
        title: '信用卡管理',
        subtitle: '按账户或客户查询卡片，维护卡面姓名与状态（对应遗留 COCRDLIC/UPC）',
        content: `
            <div class="card">
                <form class="inline-form" id="cards-form">
                    <label class="field grow"><span>账户号（可选，11 位）</span>
                        <input id="cards-account" value="${esc(cardsUi.accountId)}" maxlength="11" pattern="\\d{11}"></label>
                    <label class="field grow"><span>客户号（可选，9 位）</span>
                        <input id="cards-customer" value="${esc(cardsUi.customerId)}" maxlength="9" pattern="\\d{9}"></label>
                    <button class="btn primary" type="submit">查询</button>
                </form>
                <div id="cards-result"></div>
            </div>`
    });

    const form = document.getElementById('cards-form');
    const box = document.getElementById('cards-result');

    const load = async (page) => {
        cardsUi.page = Math.max(0, page);
        cardsUi.accountId = document.getElementById('cards-account').value.trim();
        cardsUi.customerId = document.getElementById('cards-customer').value.trim();
        box.innerHTML = '<div class="empty">加载中…</div>';
        const params = new URLSearchParams({ page: String(cardsUi.page), size: '7' });
        if (cardsUi.accountId) params.set('accountId', cardsUi.accountId);
        if (cardsUi.customerId) params.set('customerId', cardsUi.customerId);
        try {
            const result = await api(`/api/v1/cards?${params.toString()}`);
            const items = result.items || [];
            box.innerHTML = `
                ${items.length === 0 ? '<div class="empty">没有符合条件的卡片</div>' : `
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>卡号</th><th>账户</th><th>客户</th><th>卡面姓名</th><th>到期日</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>${items.map((card) => `
                        <tr>
                            <td class="mono">${esc(card.cardNumber)}</td>
                            <td class="mono">${esc(card.accountId)}</td>
                            <td class="mono">${esc(card.customerId)}</td>
                            <td>${esc(card.embossedName)}</td>
                            <td>${dateText(card.expiryDate)}</td>
                            <td>${statusBadge(card.activeStatus)}</td>
                            <td class="actions"><a class="btn ghost small" href="#/cards/${encodeURIComponent(card.cardNumber)}">查看 / 维护</a></td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${pager(cardsUi.page, result.size || 7, result.total || 0)}`;
            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    load(cardsUi.page + (button.dataset.page === 'next' ? 1 : -1));
                });
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        load(0);
    });
    load(cardsUi.page);
}

/* ---------------- 页面：卡片详情 / 维护 ---------------- */

async function pageCardDetail(cardNumber) {
    shell({
        active: 'cards',
        title: '卡片详情',
        subtitle: `卡号 ${cardNumber}`,
        content: '<div class="card" id="card-detail"><div class="empty">加载中…</div></div>'
    });
    const box = document.getElementById('card-detail');
    try {
        const card = await api(`/api/v1/cards/${encodeURIComponent(cardNumber)}`);
        const [year, month, day] = String(card.expiryDate).split('-');
        box.innerHTML = `
            <div class="grid cols-2">
                <div>
                    <h3>卡片信息</h3>
                    <dl class="dl">
                        <dt>卡号</dt><dd class="mono">${esc(card.cardNumber)}</dd>
                        <dt>所属账户</dt><dd class="mono">${esc(card.accountId)}</dd>
                        <dt>所属客户</dt><dd class="mono">${esc(card.customerId)}</dd>
                        <dt>卡面姓名</dt><dd>${esc(card.embossedName)}</dd>
                        <dt>到期日</dt><dd>${dateText(card.expiryDate)}（日 ${esc(day)} 不可修改）</dd>
                        <dt>状态</dt><dd>${statusBadge(card.activeStatus)}</dd>
                        <dt>版本号</dt><dd class="mono">${esc(card.version)}</dd>
                    </dl>
                    <div class="hint mt-16">CVV 仅存储于服务端，不对外返回，也不能通过本页面修改。</div>
                </div>
                <form id="card-form">
                    <h3>维护卡片</h3>
                    <div class="form-grid">
                        <label class="field span-2"><span>卡面姓名 <span class="req">*</span></span>
                            <input name="embossedName" value="${esc(card.embossedName)}" maxlength="50" required></label>
                        <label class="field"><span>卡状态 <span class="req">*</span></span>
                            <select name="activeStatus">
                                <option value="Y" ${card.activeStatus === 'Y' ? 'selected' : ''}>Y · 正常</option>
                                <option value="N" ${card.activeStatus === 'N' ? 'selected' : ''}>N · 停用</option>
                            </select></label>
                        <label class="field"><span>到期月 <span class="req">*</span></span>
                            <input name="expiryMonth" type="number" min="1" max="12" value="${esc(month)}" required></label>
                        <label class="field"><span>到期年 <span class="req">*</span></span>
                            <input name="expiryYear" type="number" min="1950" max="2099" value="${esc(year)}" required></label>
                    </div>
                    <div class="form-actions">
                        <button class="btn primary" type="submit" id="card-save">保存修改</button>
                        <a class="btn ghost" href="#/cards">返回列表</a>
                    </div>
                    <div id="card-msg"></div>
                </form>
            </div>`;

        const form = document.getElementById('card-form');
        const button = document.getElementById('card-save');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const values = formValues(form);
            const msg = document.getElementById('card-msg');
            msg.innerHTML = '';
            setBusy(button, true, '保存中…');
            try {
                await api(`/api/v1/cards/${encodeURIComponent(cardNumber)}`, {
                    method: 'PUT',
                    body: {
                        embossedName: values.embossedName.trim(),
                        activeStatus: values.activeStatus,
                        expiryMonth: Number(values.expiryMonth),
                        expiryYear: Number(values.expiryYear)
                    }
                });
                toast('卡片已更新', 'success');
                await pageCardDetail(cardNumber);
            } catch (error) {
                msg.innerHTML = errBox(error);
                setBusy(button, false);
            }
        });
    } catch (error) {
        box.innerHTML = errBox(error);
    }
}

/* ---------------- 页面：交易列表 ---------------- */

const txnUi = { idPrefix: '', cardNumber: '', accountId: '', page: 0 };

function pageTransactions() {
    shell({
        active: 'transactions',
        title: '交易查询',
        subtitle: '按交易号前缀、卡号或账户查询（对应遗留 COTRN00C/01C）',
        content: `
            <div class="card">
                <form class="inline-form" id="txn-form">
                    <label class="field grow"><span>交易号前缀</span>
                        <input id="txn-id" value="${esc(txnUi.idPrefix)}" maxlength="16" placeholder="如 00000000000000"></label>
                    <label class="field grow"><span>卡号</span>
                        <input id="txn-card" value="${esc(txnUi.cardNumber)}" maxlength="16" pattern="\\d{16}"></label>
                    <label class="field grow"><span>账户号</span>
                        <input id="txn-account" value="${esc(txnUi.accountId)}" maxlength="11" pattern="\\d{11}"></label>
                    <button class="btn primary" type="submit">查询</button>
                    <a class="btn ghost" href="#/transactions/new">新增交易</a>
                </form>
                <div id="txn-result"></div>
            </div>`
    });

    const form = document.getElementById('txn-form');
    const box = document.getElementById('txn-result');

    const load = async (page) => {
        txnUi.page = Math.max(0, page);
        txnUi.idPrefix = document.getElementById('txn-id').value.trim();
        txnUi.cardNumber = document.getElementById('txn-card').value.trim();
        txnUi.accountId = document.getElementById('txn-account').value.trim();
        box.innerHTML = '<div class="empty">加载中…</div>';
        const params = new URLSearchParams({ page: String(txnUi.page), size: '10' });
        if (txnUi.idPrefix) params.set('idPrefix', txnUi.idPrefix);
        if (txnUi.cardNumber) params.set('cardNumber', txnUi.cardNumber);
        if (txnUi.accountId) params.set('accountId', txnUi.accountId);
        try {
            const result = await api(`/api/v1/transactions?${params.toString()}`);
            const items = result.items || [];
            box.innerHTML = `
                ${items.length === 0 ? '<div class="empty">没有符合条件的交易</div>' : `
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>交易号</th><th>处理时间</th><th>卡号</th><th>类型 / 类别</th>
                        <th class="num">金额</th><th>描述</th><th>操作</th></tr></thead>
                    <tbody>${items.map((txn) => `
                        <tr>
                            <td class="mono">${esc(txn.transactionId)}</td>
                            <td class="nowrap">${dateTimeText(txn.processedTimestamp)}</td>
                            <td class="mono">${esc(txn.cardNumber)}</td>
                            <td>${esc(txn.typeDescription || txn.typeCode)} / ${esc(txn.categoryDescription || txn.categoryCode)}</td>
                            <td class="num mono">${money(txn.amount)}</td>
                            <td>${esc(txn.description)}</td>
                            <td class="actions"><a class="btn ghost small" href="#/transactions/${encodeURIComponent(txn.transactionId)}">详情</a></td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${pager(txnUi.page, result.size || 10, result.total || 0)}`;
            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => load(txnUi.page + (button.dataset.page === 'next' ? 1 : -1)));
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        load(0);
    });
    load(txnUi.page);
}

/* ---------------- 页面：交易详情 ---------------- */

async function pageTransactionDetail(transactionId) {
    shell({
        active: 'transactions',
        title: '交易详情',
        subtitle: `交易号 ${transactionId}`,
        content: '<div class="card" id="txn-detail"><div class="empty">加载中…</div></div>'
    });
    const box = document.getElementById('txn-detail');
    try {
        const txn = await api(`/api/v1/transactions/${encodeURIComponent(transactionId)}`);
        box.innerHTML = `
            <dl class="dl">
                <dt>交易号</dt><dd class="mono">${esc(txn.transactionId)}</dd>
                <dt>账户 / 卡号</dt><dd class="mono">${esc(txn.accountId)} / ${esc(txn.cardNumber)}</dd>
                <dt>类型</dt><dd>${esc(txn.typeCode)} · ${esc(txn.typeDescription || '')}</dd>
                <dt>类别</dt><dd>${esc(txn.categoryCode)} · ${esc(txn.categoryDescription || '')}</dd>
                <dt>来源</dt><dd>${esc(txn.source)}</dd>
                <dt>金额</dt><dd class="mono"><strong>${money(txn.amount)}</strong></dd>
                <dt>描述</dt><dd>${esc(txn.description)}</dd>
                <dt>商户</dt><dd>${esc(txn.merchantName)}（${esc(txn.merchantId)}）<br>
                    ${esc(txn.merchantCity)} ${esc(txn.merchantZip)}</dd>
                <dt>原始时间</dt><dd>${dateTimeText(txn.originalTimestamp)}</dd>
                <dt>处理时间</dt><dd>${dateTimeText(txn.processedTimestamp)}</dd>
            </dl>
            <div class="form-actions">
                <a class="btn primary" href="#/installments/new?sourceType=TRANSACTION&accountId=${encodeURIComponent(txn.accountId)}&sourceId=${encodeURIComponent(txn.transactionId)}&amount=${encodeURIComponent(txn.amount)}">申请分期</a>
                <a class="btn ghost" href="#/transactions">返回列表</a>
                <a class="btn ghost" href="#/bill-pay">去账单支付</a>
            </div>`;
    } catch (error) {
        box.innerHTML = errBox(error);
    }
}

/* ---------------- 页面：交易录入 ---------------- */

async function pageTransactionNew() {
    shell({
        active: 'transaction-new',
        title: '交易录入',
        subtitle: '人工补录一笔交易（对应遗留 COTRN02C）',
        content: '<div class="card" id="txn-new"><div class="empty">正在加载参照数据…</div></div>'
    });
    const box = document.getElementById('txn-new');
    try {
        const [types, categories] = await Promise.all([
            api('/api/v1/transaction-types'),
            api('/api/v1/transaction-categories')
        ]);
        const typeItems = types.items || [];
        const categoryItems = categories.items || [];
        const today = new Date().toISOString().slice(0, 10);

        box.innerHTML = `
            <form id="txn-new-form">
                <div class="form-grid">
                    <label class="field"><span>账户号 <span class="req">*</span></span>
                        <input name="accountId" value="00000000002" maxlength="11" pattern="\\d{11}" required></label>
                    <label class="field"><span>卡号（与账户一致）</span>
                        <input name="cardNumber" value="0683586198171516" maxlength="16" pattern="\\d{16}"></label>
                    <label class="field"><span>交易类型 <span class="req">*</span></span>
                        <select name="typeCode" id="txn-type">
                            ${typeItems.map((type) => `<option value="${esc(type.typeCode)}">${esc(type.typeCode)} · ${esc(type.description)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>交易类别 <span class="req">*</span></span>
                        <select name="categoryCode" id="txn-category"></select></label>
                    <label class="field"><span>来源 <span class="req">*</span></span>
                        <input name="source" value="POS TERM" maxlength="10" required></label>
                    <label class="field"><span>金额（-99999999.99） <span class="req">*</span></span>
                        <input name="amount" type="number" step="0.01" min="-99999999.99" max="99999999.99" value="25.99" required></label>
                    <label class="field"><span>原始日期 <span class="req">*</span></span>
                        <input name="originalDate" type="date" value="${today}" required></label>
                    <label class="field"><span>处理日期 <span class="req">*</span></span>
                        <input name="processedDate" type="date" value="${today}" required></label>
                    <label class="field span-2"><span>描述 <span class="req">*</span></span>
                        <input name="description" value="Purchase at Test Merchant" maxlength="100" required></label>
                    <label class="field"><span>商户号 <span class="req">*</span></span>
                        <input name="merchantId" value="800000123" maxlength="9" pattern="\\d{9}" required></label>
                    <label class="field"><span>商户名称 <span class="req">*</span></span>
                        <input name="merchantName" value="Test Merchant" maxlength="50" required></label>
                    <label class="field"><span>商户城市 <span class="req">*</span></span>
                        <input name="merchantCity" value="Springfield" maxlength="50" required></label>
                    <label class="field"><span>商户邮编 <span class="req">*</span></span>
                        <input name="merchantZip" value="10001" maxlength="10" required></label>
                </div>
                <div class="form-actions">
                    <button class="btn primary" type="submit" id="txn-new-save">提交交易</button>
                    <a class="btn ghost" href="#/transactions">返回列表</a>
                </div>
                <div id="txn-new-msg"></div>
            </form>`;

        const form = document.getElementById('txn-new-form');
        const typeSelect = document.getElementById('txn-type');
        const categorySelect = document.getElementById('txn-category');

        const renderCategories = () => {
            const type = typeSelect.value;
            const filtered = categoryItems.filter((item) => item.typeCode === type);
            categorySelect.innerHTML = filtered.map((item) =>
                `<option value="${esc(item.categoryCode)}">${esc(item.categoryCode)} · ${esc(item.description)}</option>`).join('')
                || '<option value="">（该类型无类别）</option>';
        };
        typeSelect.addEventListener('change', renderCategories);
        renderCategories();

        const button = document.getElementById('txn-new-save');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const values = formValues(form);
            const msg = document.getElementById('txn-new-msg');
            msg.innerHTML = '';
            setBusy(button, true, '提交中…');
            try {
                const created = await api('/api/v1/transactions', {
                    method: 'POST',
                    body: {
                        accountId: values.accountId.trim(),
                        cardNumber: values.cardNumber.trim() || null,
                        typeCode: values.typeCode,
                        categoryCode: values.categoryCode,
                        source: values.source.trim(),
                        description: values.description.trim(),
                        amount: Number(values.amount),
                        originalDate: values.originalDate,
                        processedDate: values.processedDate,
                        merchantId: values.merchantId.trim(),
                        merchantName: values.merchantName.trim(),
                        merchantCity: values.merchantCity.trim(),
                        merchantZip: values.merchantZip.trim()
                    }
                });
                toast(`交易已创建：${created.transactionId}`, 'success');
                location.hash = `#/transactions/${created.transactionId}`;
            } catch (error) {
                msg.innerHTML = errBox(error);
                setBusy(button, false);
            }
        });
    } catch (error) {
        box.innerHTML = errBox(error);
    }
}

/* ---------------- 页面：账单支付 ---------------- */

function pageBillPay() {
    shell({
        active: 'bill-pay',
        title: '账单支付',
        subtitle: '全额偿还账户当前欠款（对应遗留 COBIL00C）',
        content: `
            <div class="grid cols-2">
                <div class="card">
                    <h3>查询账户</h3>
                    <form class="inline-form" id="bill-lookup">
                        <label class="field grow"><span>账户号（11 位）</span>
                            <input id="bill-account" value="00000000001" maxlength="11" pattern="\\d{11}" required></label>
                        <button class="btn ghost" type="submit">查询余额</button>
                    </form>
                    <div id="bill-info"></div>
                </div>
                <div class="card">
                    <h3>确认支付</h3>
                    <p class="hint">支付金额恒等于账户当前欠款余额，支付后余额归零。余额 ≤ 0 时不可支付。</p>
                    <form id="bill-form">
                        <label class="checkbox"><input type="checkbox" name="confirm" id="bill-confirm"> 我确认执行全额还款</label>
                        <div class="form-actions">
                            <button class="btn primary" type="submit" id="bill-submit">执行支付</button>
                            <a class="btn ghost" href="#/installments/new?sourceType=BILL">账单分期</a>
                        </div>
                        <div id="bill-msg"></div>
                    </form>
                </div>
            </div>`
    });

    const info = document.getElementById('bill-info');
    let current = null;

    const lookup = async () => {
        const accountId = document.getElementById('bill-account').value.trim();
        info.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const account = await api(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
            current = account;
            const available = Number(account.creditLimit) - Number(account.currentBalance);
            info.innerHTML = `
                <div class="grid cols-2 mt-16">
                    <div class="stat">
                        <div class="label">当前欠款余额</div>
                        <div class="value">${money(account.currentBalance)}</div>
                    </div>
                    <div class="stat">
                        <div class="label">可用额度</div>
                        <div class="value">${money(available)}</div>
                    </div>
                </div>
                <div class="hint mt-16">账户 ${esc(account.accountId)} · 额度 ${money(account.creditLimit)} · ${statusBadge(account.activeStatus)}</div>`;
        } catch (error) {
            current = null;
            info.innerHTML = errBox(error);
        }
    };

    document.getElementById('bill-lookup').addEventListener('submit', (event) => {
        event.preventDefault();
        lookup();
    });

    const form = document.getElementById('bill-form');
    const button = document.getElementById('bill-submit');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const msg = document.getElementById('bill-msg');
        msg.innerHTML = '';
        if (!current) {
            msg.innerHTML = '<div class="alert error">请先查询账户余额</div>';
            return;
        }
        if (!document.getElementById('bill-confirm').checked) {
            msg.innerHTML = '<div class="alert error">请勾选确认后再提交</div>';
            return;
        }
        setBusy(button, true, '支付中…');
        try {
            const result = await api('/api/v1/bill-payments', {
                method: 'POST',
                body: { accountId: current.accountId, confirm: true }
            });
            msg.innerHTML = `
                <div class="alert success">
                    支付成功：交易号 <code>${esc(result.transactionId)}</code>，
                    金额 <strong>${money(result.amount)}</strong>，账户新余额 <strong>${money(result.newBalance)}</strong>。
                    <div class="mt-16"><a href="#/transactions/${encodeURIComponent(result.transactionId)}">查看交易</a></div>
                </div>`;
            toast('账单支付成功', 'success');
            await lookup();
        } catch (error) {
            msg.innerHTML = errBox(error);
        } finally {
            setBusy(button, false);
        }
    });

    lookup();
}

/* ---------------- 页面：交易报表 ---------------- */

function pageReports() {
    shell({
        active: 'reports',
        title: '交易报表',
        subtitle: '按处理日期闭区间统计交易明细与合计（对应遗留 CORPT00C / CBTRN03C）',
        content: `
            <div class="card">
                <form class="inline-form" id="report-form">
                    <label class="field grow"><span>开始日期</span>
                        <input id="report-start" type="date" value="2026-09-01" required></label>
                    <label class="field grow"><span>结束日期</span>
                        <input id="report-end" type="date" value="2026-09-30" required></label>
                    <label class="field grow"><span>卡号（可选）</span>
                        <input id="report-card" maxlength="16" pattern="\\d{16}"></label>
                    <button class="btn primary" type="submit">生成报表</button>
                </form>
                <div id="report-result"></div>
            </div>`
    });

    const form = document.getElementById('report-form');
    const box = document.getElementById('report-result');

    const run = async () => {
        const startDate = document.getElementById('report-start').value;
        const endDate = document.getElementById('report-end').value;
        const cardNumber = document.getElementById('report-card').value.trim();
        if (!startDate || !endDate) {
            box.innerHTML = '<div class="alert error">请选择开始与结束日期</div>';
            return;
        }
        const params = new URLSearchParams({ startDate, endDate, page: '0', size: '50' });
        if (cardNumber) params.set('cardNumber', cardNumber);
        box.innerHTML = '<div class="empty">统计中…</div>';
        try {
            const report = await api(`/api/v1/reports/transactions?${params.toString()}`);
            const items = report.items || [];
            box.innerHTML = `
                <div class="grid cols-3 mt-16">
                    <div class="stat"><div class="label">交易笔数</div><div class="value">${report.total}</div></div>
                    <div class="stat"><div class="label">区间合计</div><div class="value">${money(report.grandTotal)}</div></div>
                    <div class="stat"><div class="label">本页合计</div><div class="value">${money(report.pageTotal)}</div></div>
                </div>
                ${items.length === 0 ? '<div class="empty">该区间没有交易</div>' : `
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>交易号</th><th>处理时间</th><th>卡号</th><th>类型 / 类别</th>
                        <th class="num">金额</th><th>描述</th></tr></thead>
                    <tbody>${items.map((txn) => `
                        <tr>
                            <td class="mono"><a href="#/transactions/${encodeURIComponent(txn.transactionId)}">${esc(txn.transactionId)}</a></td>
                            <td class="nowrap">${dateTimeText(txn.processedTimestamp)}</td>
                            <td class="mono">${esc(txn.cardNumber)}</td>
                            <td>${esc(txn.typeDescription || txn.typeCode)} / ${esc(txn.categoryDescription || txn.categoryCode)}</td>
                            <td class="num mono">${money(txn.amount)}</td>
                            <td>${esc(txn.description)}</td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${(report.accountTotals && report.accountTotals.length) ? `
                <div class="card mt-16">
                    <h3>按卡号合计</h3>
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>卡号</th><th class="num">合计</th></tr></thead>
                        <tbody>${report.accountTotals.map((row) => `
                            <tr><td class="mono">${esc(row.cardNumber)}</td><td class="num mono">${money(row.total)}</td></tr>`).join('')}
                        </tbody></table></div>
                </div>` : ''}`;
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        run();
    });
    run();
}

/* ---------------- 页面：授权管理 ---------------- */

const authUi = { accountId: '00000000001', page: 0 };

async function pageAuthorizations() {
    shell({
        active: 'authorizations',
        title: '授权管理',
        subtitle: '待授权汇总、授权明细、欺诈标记与过期清理（对应遗留 COPAUS0C/1C/2C、CBPAUP0C）',
        content: `
            <div class="card">
                <form class="inline-form" id="auth-form">
                    <label class="field grow"><span>账户号（11 位）</span>
                        <input id="auth-account" value="${esc(authUi.accountId)}" maxlength="11" pattern="\\d{11}" required></label>
                    <button class="btn primary" type="submit">查询</button>
                </form>
                <div id="auth-result"></div>
            </div>`
    });

    const form = document.getElementById('auth-form');
    const box = document.getElementById('auth-result');

    const load = async (page) => {
        authUi.accountId = document.getElementById('auth-account').value.trim();
        authUi.page = Math.max(0, page);
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const summary = await api(`/api/v1/pending-authorizations/${encodeURIComponent(authUi.accountId)}`)
                .catch((error) => (error.status === 404 ? null : Promise.reject(error)));
            const list = await api(`/api/v1/authorizations?accountId=${encodeURIComponent(authUi.accountId)}&page=${authUi.page}&size=10`);
            const items = list.items || [];

            box.innerHTML = `
                ${summary ? `
                <div class="grid cols-4 mt-16">
                    <div class="stat"><div class="label">信用额度</div><div class="value">${money(summary.creditLimit)}</div></div>
                    <div class="stat"><div class="label">待授权占用</div><div class="value">${money(summary.creditBalance)}</div></div>
                    <div class="stat"><div class="label">批准笔数</div><div class="value">${summary.approvedCount}<small>${money(summary.approvedAmount)}</small></div></div>
                    <div class="stat"><div class="label">拒绝笔数</div><div class="value">${summary.declinedCount}<small>${money(summary.declinedAmount)}</small></div></div>
                </div>` : '<div class="alert info mt-16">该账户暂无待授权汇总；新授权批准后会自动创建。</div>'}

                ${items.length === 0 ? '<div class="empty">暂无授权记录</div>' : `
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>授权时间</th><th>卡号</th><th class="num">金额</th><th>结果</th>
                        <th>原因码</th><th>商户</th><th>欺诈</th><th>操作</th></tr></thead>
                    <tbody>${items.map((item) => `
                        <tr>
                            <td class="nowrap">${dateTimeText(item.authTimestamp)}</td>
                            <td class="mono">${esc(item.cardNumber)}</td>
                            <td class="num mono">${money(item.transactionAmount)}</td>
                            <td>${authBadge(item.responseCode)}</td>
                            <td class="mono">${esc(item.reasonCode)}</td>
                            <td>${esc(item.merchantName || '—')}</td>
                            <td>${item.fraudFlag === 'Y' ? '<span class="badge bad">已标记</span>' : '<span class="badge neutral">正常</span>'}</td>
                            <td>${item.fraudFlag === 'Y' ? '—' : `<button class="btn danger small" data-fraud="${esc(item.authorizationId)}" data-card="${esc(item.cardNumber)}">标记欺诈</button>`}</td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${pager(authUi.page, list.size || 10, list.total || 0)}

                <div class="card mt-16">
                    <h3>过期授权清理</h3>
                    <p class="hint">删除早于“今天 − 过期天数”的授权明细，并回退其占用的信用额度。</p>
                    <form class="inline-form" id="purge-form">
                        <label class="field"><span>过期天数</span>
                            <input id="purge-days" type="number" min="1" max="365" value="5" style="width:120px"></label>
                        <button class="btn ghost" type="submit">执行清理</button>
                    </form>
                    <div id="purge-msg"></div>
                </div>`;

            box.querySelectorAll('[data-fraud]').forEach((button) => {
                button.addEventListener('click', async () => {
                    const id = button.dataset.fraud;
                    if (!window.confirm(`确认将授权 ${id} 标记为欺诈？该卡后续授权将被拒绝（5100）。`)) return;
                    setBusy(button, true, '处理中…');
                    try {
                        await api(`/api/v1/authorizations/${encodeURIComponent(id)}/fraud`, { method: 'POST' });
                        toast('已标记欺诈，卡号 ' + button.dataset.card + ' 后续授权将被拒绝', 'success');
                        await load(authUi.page);
                    } catch (error) {
                        toast(error.message, 'error');
                        setBusy(button, false);
                    }
                });
            });

            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => load(authUi.page + (button.dataset.page === 'next' ? 1 : -1)));
            });

            const purgeForm = document.getElementById('purge-form');
            purgeForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const days = Number(document.getElementById('purge-days').value);
                if (!window.confirm(`确认清理 ${days} 天前的授权明细？`)) return;
                const msg = document.getElementById('purge-msg');
                msg.innerHTML = '';
                try {
                    const result = await api('/api/v1/authorization-purges', {
                        method: 'POST',
                        body: { expiryDays: days }
                    });
                    msg.innerHTML = `<div class="alert success">
                        明细删除 ${result.detailsDeleted} 条，汇总删除 ${result.summariesDeleted} 个，
                        回退占用额度 ${money(result.creditBalanceReleased)}。</div>`;
                    await load(0);
                } catch (error) {
                    msg.innerHTML = errBox(error);
                }
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        load(0);
    });
    load(authUi.page);
}

/* ---------------- 页面：营销 ---------------- */

const campaignsUi = { page: 0, status: '' };
const rewardsUi = { page: 0 };
const offersUi = { accountId: '00000000001', cardNumber: '0500024453765740', customerId: '000000001' };

const CAMPAIGN_TYPE_TEXT = {
    FIRST_PURCHASE_CASHBACK: '首刷返现',
    CATEGORY_CASHBACK: '类别返现',
    POINTS_MULTIPLIER: '积分倍数'
};
const CAMPAIGN_STATUS_TEXT = { DRAFT: '草稿', ACTIVE: '进行中', PAUSED: '已暂停', ENDED: '已结束' };
const REWARD_STATUS_TEXT = { GRANTED: '已发放', PENDING: '待入账', FAILED: '失败' };
const ELIGIBILITY_REASON_TEXT = {
    CAMPAIGN_NOT_ACTIVE: '活动未生效',
    NOT_ACTIVE: '活动未生效',
    ACCOUNT_NOT_FOUND: '账户不存在',
    ACCOUNT_INACTIVE: '账户已停用',
    ACCOUNT_GROUP_MISMATCH: '不在活动目标客群',
    CATEGORY_MISMATCH: '交易类别不符',
    AMOUNT_TOO_LOW: '未达最低消费金额',
    NOT_ENROLLED: '需要先报名',
    CARD_LIMIT_REACHED: '已达活动参与次数上限',
    FIRST_PURCHASE_ALREADY_REWARDED: '已享受过首刷礼',
    BUDGET_EXHAUSTED: '活动预算已用完',
    REWARD_ZERO: '奖励金额为 0',
    ALREADY_EVALUATED: '该交易已评估过'
};

const reasonText = (reason) => (reason ? (ELIGIBILITY_REASON_TEXT[reason] || reason) : '');

function campaignStatusBadge(status) {
    const cls = status === 'ACTIVE' ? 'ok' : status === 'PAUSED' ? 'warn'
        : status === 'DRAFT' ? 'neutral' : 'bad';
    return `<span class="badge ${cls}">${CAMPAIGN_STATUS_TEXT[status] || esc(status)}</span>`;
}

function rewardStatusBadge(status) {
    const cls = status === 'GRANTED' ? 'ok' : status === 'PENDING' ? 'warn' : 'bad';
    return `<span class="badge ${cls}">${REWARD_STATUS_TEXT[status] || esc(status)}</span>`;
}

function campaignRewardText(campaign) {
    if (campaign.campaignType === 'POINTS_MULTIPLIER') {
        return `${campaign.pointsMultiplier} 倍积分`;
    }
    if (campaign.fixedRewardAmount && Number(campaign.fixedRewardAmount) > 0) {
        return `返现 ${money(campaign.fixedRewardAmount)}`;
    }
    if (campaign.rewardRate) {
        const percent = (Number(campaign.rewardRate) * 100).toFixed(2).replace(/\.?0+$/, '');
        return `${percent}% 返现${campaign.maxRewardPerTransaction
            ? `（单笔上限 ${money(campaign.maxRewardPerTransaction)}）` : ''}`;
    }
    return '—';
}

/* ---------------- 页面：活动中心 ---------------- */

function pageOffers() {
    shell({
        active: 'offers',
        title: '活动中心',
        subtitle: '查看当前可参与的营销活动，报名后消费达标自动返现/积分',
        content: `
            <div class="card">
                <form class="inline-form" id="offers-form">
                    <label class="field grow"><span>账户号（11 位）</span>
                        <input id="offers-account" value="${esc(offersUi.accountId)}" maxlength="11" pattern="\\d{11}" required></label>
                    <label class="field grow"><span>卡号（16 位）</span>
                        <input id="offers-card" value="${esc(offersUi.cardNumber)}" maxlength="16" pattern="\\d{16}" required></label>
                    <label class="field grow"><span>客户号（可选）</span>
                        <input id="offers-customer" value="${esc(offersUi.customerId)}" maxlength="9" pattern="\\d{9}"></label>
                    <button class="btn primary" type="submit">查询活动</button>
                </form>
                <div id="offers-result"></div>
            </div>`
    });

    const form = document.getElementById('offers-form');
    const box = document.getElementById('offers-result');

    const load = async () => {
        offersUi.accountId = document.getElementById('offers-account').value.trim();
        offersUi.cardNumber = document.getElementById('offers-card').value.trim();
        offersUi.customerId = document.getElementById('offers-customer').value.trim();
        const params = new URLSearchParams({
            accountId: offersUi.accountId,
            cardNumber: offersUi.cardNumber
        });
        if (offersUi.customerId) params.set('customerId', offersUi.customerId);
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const result = await api(`/api/v1/eligibilities?${params.toString()}`);
            const items = result.items || [];
            box.innerHTML = items.length === 0
                ? '<div class="empty">当前没有可参与的活动</div>'
                : `<div class="grid cols-2 mt-16">${items.map(offerCard).join('')}</div>`;

            box.querySelectorAll('[data-enroll]').forEach((button) => {
                button.addEventListener('click', async () => {
                    const campaignId = button.dataset.enroll;
                    setBusy(button, true, '报名中…');
                    try {
                        await api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/enrollments`, {
                            method: 'POST',
                            body: {
                                cardNumber: offersUi.cardNumber,
                                accountId: offersUi.accountId,
                                customerId: offersUi.customerId || null
                            }
                        });
                        toast('报名成功，消费达标后自动返现', 'success');
                        await load();
                    } catch (error) {
                        toast(`${error.code || '报名失败'}：${error.message}`, 'error');
                        setBusy(button, false);
                    }
                });
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        load();
    });
    load();
}

function offerCard(offer) {
    const needsEnrollment = offer.enrollmentRequired && !offer.enrolled;
    const enrolledBadge = offer.enrolled
        ? '<span class="badge ok">已报名</span>'
        : needsEnrollment
            ? '<span class="badge warn">需报名</span>'
            : offer.eligible
                ? '<span class="badge neutral">可参与</span>'
                : '<span class="badge warn">暂不可参与</span>';
    const action = needsEnrollment
        ? `<div class="alert info" style="margin:14px 0 0">该活动需要报名，报名后消费达标即可获得奖励。</div>
           <div class="form-actions"><button class="btn primary small" data-enroll="${esc(offer.campaignId)}">立即报名</button></div>`
        : !offer.eligible
            ? `<div class="alert info" style="margin:14px 0 0">${esc(reasonText(offer.reason))}</div>`
            : '<div class="hint mt-16">已满足参与条件，达标消费会自动发放奖励。</div>';
    return `
        <div class="card">
            <div class="section-title">
                <h3>${esc(offer.name)}</h3>${enrolledBadge}
            </div>
            <p class="muted" style="margin:0 0 12px">${esc(offer.description || '')}</p>
            <dl class="dl">
                <dt>奖励</dt><dd><strong>${esc(offer.rewardSummary)}</strong></dd>
                <dt>有效期</dt><dd>${dateText(offer.startAt)} ~ ${dateText(offer.endAt)}</dd>
                <dt>参与门槛</dt><dd>单笔 ≥ ${money(offer.minTransactionAmount)}${offer.categoryCode
                    ? ` · 类别 ${esc(offer.categoryCode)}` : ''}</dd>
                <dt>次数限制</dt><dd>${offer.maxRewardsPerCard ? `每卡 ${offer.maxRewardsPerCard} 次` : '不限'}</dd>
                <dt>报名要求</dt><dd>${offer.enrollmentRequired ? '需要报名' : '无需报名'}</dd>
                ${offer.remainingBudget !== null && offer.remainingBudget !== undefined
                    ? `<dt>剩余预算</dt><dd>${money(offer.remainingBudget)}</dd>` : ''}
            </dl>
            ${action}
        </div>`;
}

/* ---------------- 页面：我的奖励 ---------------- */

function pageRewards() {
    shell({
        active: 'rewards',
        title: '我的奖励',
        subtitle: '返现与积分发放记录；待入账的返现可重试',
        content: `
            <div class="card">
                <form class="inline-form" id="rewards-form">
                    <label class="field grow"><span>账户号</span>
                        <input id="rewards-account" value="${esc(offersUi.accountId)}" maxlength="11" pattern="\\d{11}"></label>
                    <label class="field grow"><span>卡号（可选）</span>
                        <input id="rewards-card" value="${esc(offersUi.cardNumber)}" maxlength="16" pattern="\\d{16}"></label>
                    <button class="btn primary" type="submit">查询奖励</button>
                </form>
                <div id="rewards-result"></div>
            </div>`
    });

    const form = document.getElementById('rewards-form');
    const box = document.getElementById('rewards-result');

    const load = async (page) => {
        rewardsUi.page = Math.max(0, page);
        const accountId = document.getElementById('rewards-account').value.trim();
        const cardNumber = document.getElementById('rewards-card').value.trim();
        const params = new URLSearchParams({ page: String(rewardsUi.page), size: '10' });
        if (accountId) params.set('accountId', accountId);
        if (cardNumber) params.set('cardNumber', cardNumber);
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const result = await api(`/api/v1/rewards?${params.toString()}`);
            const items = result.items || [];
            box.innerHTML = `
                ${items.length === 0 ? '<div class="empty">暂无奖励记录</div>' : `
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>时间</th><th>活动</th><th>交易号</th><th>奖励</th>
                        <th>状态</th><th>说明</th><th>操作</th></tr></thead>
                    <tbody>${items.map((reward) => `
                        <tr>
                            <td class="nowrap">${dateTimeText(reward.createdAt)}</td>
                            <td>${esc(reward.campaignName)}</td>
                            <td class="mono">${reward.transactionId
                                ? `<a href="#/transactions/${encodeURIComponent(reward.transactionId)}">${esc(reward.transactionId)}</a>`
                                : '—'}</td>
                            <td>${reward.rewardType === 'CASHBACK'
                                ? `返现 <strong>${money(reward.rewardAmount)}</strong>`
                                : `积分 <strong>${esc(reward.rewardPoints)}</strong>`}</td>
                            <td>${rewardStatusBadge(reward.status)}</td>
                            <td class="muted">${esc(reward.failureReason || '—')}</td>
                            <td>${reward.status === 'PENDING'
                                ? `<button class="btn ghost small" data-retry="${esc(reward.rewardId)}">重试入账</button>`
                                : '—'}</td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${pager(rewardsUi.page, result.size || 10, result.total || 0)}`;

            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () =>
                    load(rewardsUi.page + (button.dataset.page === 'next' ? 1 : -1)));
            });
            box.querySelectorAll('[data-retry]').forEach((button) => {
                button.addEventListener('click', async () => {
                    setBusy(button, true, '处理中…');
                    try {
                        await api(`/api/v1/rewards/${encodeURIComponent(button.dataset.retry)}/fulfill`,
                            { method: 'POST' });
                        toast('返现已入账', 'success');
                        await load(rewardsUi.page);
                    } catch (error) {
                        toast(`${error.code || '重试失败'}：${error.message}`, 'error');
                        setBusy(button, false);
                    }
                });
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        load(0);
    });
    load(rewardsUi.page);
}

/* ---------------- 页面：活动管理 ---------------- */

function pageCampaigns() {
    if (!requireAdmin('campaigns', '活动管理')) return;
    shell({
        active: 'campaigns',
        title: '活动管理',
        subtitle: '创建、发布、暂停活动并查看效果（管理员）',
        content: `
            <div class="card">
                <div class="section-title">
                    <form class="inline-form" id="campaigns-filter">
                        <label class="field"><span>状态</span>
                            <select id="campaigns-status">
                                <option value="">全部</option>
                                <option value="DRAFT">草稿</option>
                                <option value="ACTIVE">进行中</option>
                                <option value="PAUSED">已暂停</option>
                                <option value="ENDED">已结束</option>
                            </select></label>
                        <button class="btn ghost" type="submit">筛选</button>
                    </form>
                    <a class="btn primary small" href="#/campaigns/new">新建活动</a>
                </div>
                <div id="campaigns-result"></div>
            </div>`
    });

    const box = document.getElementById('campaigns-result');
    const filter = document.getElementById('campaigns-filter');

    const load = async (page) => {
        campaignsUi.page = Math.max(0, page);
        campaignsUi.status = document.getElementById('campaigns-status').value;
        const params = new URLSearchParams({ page: String(campaignsUi.page), size: '10' });
        if (campaignsUi.status) params.set('status', campaignsUi.status);
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const result = await api(`/api/v1/campaigns?${params.toString()}`);
            const items = result.items || [];
            box.innerHTML = `
                ${items.length === 0 ? '<div class="empty">暂无活动</div>' : `
                <div class="table-wrap"><table class="table">
                    <thead><tr><th>活动</th><th>类型</th><th>奖励</th><th>期间</th><th>状态</th>
                        <th class="num">预算使用</th><th>操作</th></tr></thead>
                    <tbody>${items.map((campaign) => {
                        const used = Number(campaign.consumedAmount || 0);
                        const budget = Number(campaign.budget || 0);
                        const percent = budget > 0 ? ((used / budget) * 100).toFixed(1) : '—';
                        return `
                        <tr>
                            <td><a href="#/campaigns/${encodeURIComponent(campaign.campaignId)}">${esc(campaign.name)}</a>
                                ${campaign.enrollmentRequired ? '<span class="badge neutral">需报名</span>' : ''}</td>
                            <td>${esc(CAMPAIGN_TYPE_TEXT[campaign.campaignType] || campaign.campaignType)}</td>
                            <td>${esc(campaign.rewardSummary)}</td>
                            <td class="nowrap">${dateText(campaign.startAt)} ~ ${dateText(campaign.endAt)}</td>
                            <td>${campaignStatusBadge(campaign.status)}</td>
                            <td class="num">${money(used)} / ${money(budget)}${budget > 0 ? `（${percent}%）` : ''}</td>
                            <td class="actions">
                                <a class="btn ghost small" href="#/campaigns/${encodeURIComponent(campaign.campaignId)}">详情</a>
                                ${campaign.status === 'DRAFT'
                                    ? `<button class="btn primary small" data-transition="activate" data-id="${esc(campaign.campaignId)}">发布</button>`
                                    : campaign.status === 'ACTIVE'
                                        ? `<button class="btn ghost small" data-transition="pause" data-id="${esc(campaign.campaignId)}">暂停</button>`
                                        : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                    </tbody></table></div>`}
                ${pager(campaignsUi.page, result.size || 10, result.total || 0)}`;

            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () =>
                    load(campaignsUi.page + (button.dataset.page === 'next' ? 1 : -1)));
            });
            box.querySelectorAll('[data-transition]').forEach((button) => {
                button.addEventListener('click', async () => {
                    setBusy(button, true, '处理中…');
                    try {
                        await api(`/api/v1/campaigns/${encodeURIComponent(button.dataset.id)}/${button.dataset.transition}`,
                            { method: 'POST' });
                        toast('操作成功', 'success');
                        await load(campaignsUi.page);
                    } catch (error) {
                        toast(`${error.code || '操作失败'}：${error.message}`, 'error');
                        setBusy(button, false);
                    }
                });
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };

    filter.addEventListener('submit', (event) => {
        event.preventDefault();
        load(0);
    });
    load(campaignsUi.page);
}

function campaignFormHtml(campaign = {}) {
    const start = campaign.startAt ? String(campaign.startAt).slice(0, 16) : '2026-11-01T00:00';
    const end = campaign.endAt ? String(campaign.endAt).slice(0, 16) : '2026-11-30T23:59';
    const value = (v) => (v === null || v === undefined ? '' : v);
    return `
        <div class="form-grid">
            <label class="field span-2"><span>活动名称 <span class="req">*</span></span>
                <input name="name" value="${esc(value(campaign.name))}" maxlength="80" required></label>
            <label class="field span-2"><span>描述</span>
                <input name="description" value="${esc(value(campaign.description))}" maxlength="300"></label>
            <label class="field"><span>活动类型 <span class="req">*</span></span>
                <select name="campaignType">
                    ${Object.entries(CAMPAIGN_TYPE_TEXT).map(([key, label]) => `
                        <option value="${key}" ${campaign.campaignType === key ? 'selected' : ''}>${label}</option>`).join('')}
                </select></label>
            <label class="field"><span>目标账户组（可选）</span>
                <input name="targetGroupId" value="${esc(value(campaign.targetGroupId))}" maxlength="10" placeholder="如 A000000000"></label>
            <label class="field"><span>开始时间 <span class="req">*</span></span>
                <input name="startAt" type="datetime-local" value="${esc(start)}" required></label>
            <label class="field"><span>结束时间 <span class="req">*</span></span>
                <input name="endAt" type="datetime-local" value="${esc(end)}" required></label>
            <label class="field"><span>交易类别（可选）</span>
                <input name="categoryCode" value="${esc(value(campaign.categoryCode))}" maxlength="4" placeholder="如 0001"></label>
            <label class="field"><span>最低交易金额</span>
                <input name="minTransactionAmount" type="number" step="0.01" min="0" value="${value(campaign.minTransactionAmount) || 0}"></label>
            <label class="field"><span>返现率（0.05 = 5%）</span>
                <input name="rewardRate" type="number" step="0.0001" min="0" value="${value(campaign.rewardRate)}"></label>
            <label class="field"><span>固定返现额</span>
                <input name="fixedRewardAmount" type="number" step="0.01" min="0" value="${value(campaign.fixedRewardAmount)}"></label>
            <label class="field"><span>单笔返现上限</span>
                <input name="maxRewardPerTransaction" type="number" step="0.01" min="0" value="${value(campaign.maxRewardPerTransaction)}"></label>
            <label class="field"><span>每卡最多奖励次数</span>
                <input name="maxRewardsPerCard" type="number" min="1" value="${value(campaign.maxRewardsPerCard)}"></label>
            <label class="field"><span>积分倍数</span>
                <input name="pointsMultiplier" type="number" step="0.1" min="0" value="${value(campaign.pointsMultiplier)}"></label>
            <label class="field"><span>预算（返现活动必填）</span>
                <input name="budget" type="number" step="0.01" min="0" value="${value(campaign.budget) || 0}"></label>
            <label class="checkbox span-2">
                <input type="checkbox" name="enrollmentRequired" ${campaign.enrollmentRequired ? 'checked' : ''}>
                需要用户报名后参与
            </label>
        </div>
        <div class="hint mt-16">
            类型规则：首刷礼需固定返现额；类别返现需返现率或固定额，且预算 &gt; 0；积分倍数活动需倍数。
            只有草稿状态可以编辑规则。
        </div>`;
}

function campaignPayload(form) {
    const values = formValues(form);
    const numberOrNull = (raw) => (raw === '' || raw === null || raw === undefined ? null : Number(raw));
    return {
        name: values.name.trim(),
        description: values.description ? values.description.trim() : null,
        campaignType: values.campaignType,
        startAt: values.startAt,
        endAt: values.endAt,
        targetGroupId: values.targetGroupId ? values.targetGroupId.trim() : null,
        categoryCode: values.categoryCode ? values.categoryCode.trim() : null,
        minTransactionAmount: numberOrNull(values.minTransactionAmount),
        rewardRate: numberOrNull(values.rewardRate),
        fixedRewardAmount: numberOrNull(values.fixedRewardAmount),
        maxRewardPerTransaction: numberOrNull(values.maxRewardPerTransaction),
        maxRewardsPerCard: numberOrNull(values.maxRewardsPerCard),
        budget: numberOrNull(values.budget),
        pointsMultiplier: numberOrNull(values.pointsMultiplier),
        enrollmentRequired: form.querySelector('[name="enrollmentRequired"]').checked
    };
}

function pageCampaignNew() {
    if (!requireAdmin('campaigns', '活动管理')) return;
    shell({
        active: 'campaigns',
        title: '新建活动',
        subtitle: '创建后为草稿状态，发布后才对用户可见',
        content: `
            <div class="card">
                <form id="campaign-form">
                    ${campaignFormHtml({})}
                    <div class="form-actions">
                        <button class="btn primary" type="submit" id="campaign-save">创建草稿</button>
                        <a class="btn ghost" href="#/campaigns">返回列表</a>
                    </div>
                    <div id="campaign-msg"></div>
                </form>
            </div>`
    });

    const form = document.getElementById('campaign-form');
    const button = document.getElementById('campaign-save');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const msg = document.getElementById('campaign-msg');
        msg.innerHTML = '';
        setBusy(button, true, '创建中…');
        try {
            const created = await api('/api/v1/campaigns', { method: 'POST', body: campaignPayload(form) });
            toast('活动已创建（草稿）', 'success');
            location.hash = `#/campaigns/${created.campaignId}`;
        } catch (error) {
            msg.innerHTML = errBox(error);
            setBusy(button, false);
        }
    });
}

async function pageCampaignDetail(campaignId) {
    if (!requireAdmin('campaigns', '活动管理')) return;
    shell({
        active: 'campaigns',
        title: '活动详情',
        subtitle: campaignId,
        content: '<div class="card" id="campaign-detail"><div class="empty">加载中…</div></div>'
    });
    const box = document.getElementById('campaign-detail');
    try {
        const [campaign, performance] = await Promise.all([
            api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`),
            api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/performance`)
        ]);
        const percent = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
        const canActivate = campaign.status === 'DRAFT' || campaign.status === 'PAUSED';
        const canPause = campaign.status === 'ACTIVE';
        const canEnd = campaign.status === 'ACTIVE' || campaign.status === 'PAUSED';

        box.innerHTML = `
            <div class="section-title">
                <h3>${esc(campaign.name)} ${campaignStatusBadge(campaign.status)}</h3>
                <div class="actions">
                    ${canActivate ? `<button class="btn primary small" data-transition="activate">${campaign.status === 'DRAFT' ? '发布活动' : '恢复活动'}</button>` : ''}
                    ${canPause ? '<button class="btn ghost small" data-transition="pause">暂停</button>' : ''}
                    ${canEnd ? '<button class="btn danger small" data-transition="end">结束活动</button>' : ''}
                </div>
            </div>
            <p class="muted" style="margin:0 0 16px">${esc(campaign.description || '')}</p>

            <div class="grid cols-4 mb-16">
                <div class="stat"><div class="label">报名人数</div><div class="value">${performance.enrolledCount}</div></div>
                <div class="stat"><div class="label">已发奖励</div><div class="value">${performance.grantedCount}
                    <small>待入账 ${performance.pendingCount}</small></div></div>
                <div class="stat"><div class="label">返现成本</div><div class="value">${money(performance.cashbackTotal)}</div></div>
                <div class="stat"><div class="label">预算使用率</div><div class="value">${percent(performance.budgetUtilization)}</div></div>
            </div>

            <dl class="dl mb-16">
                <dt>活动类型</dt><dd>${esc(CAMPAIGN_TYPE_TEXT[campaign.campaignType] || campaign.campaignType)}</dd>
                <dt>奖励规则</dt><dd>${esc(campaignRewardText(campaign))}</dd>
                <dt>有效期</dt><dd>${dateTimeText(campaign.startAt)} ~ ${dateTimeText(campaign.endAt)}</dd>
                <dt>目标账户组</dt><dd>${esc(campaign.targetGroupId || '全部账户')}</dd>
                <dt>交易类别</dt><dd>${esc(campaign.categoryCode || '不限')}</dd>
                <dt>最低金额 / 每卡次数</dt>
                    <dd>${money(campaign.minTransactionAmount)} / ${campaign.maxRewardsPerCard || '不限'}</dd>
                <dt>预算 / 已消耗</dt><dd>${money(campaign.budget)} / ${money(campaign.consumedAmount)}</dd>
                <dt>报名要求</dt><dd>${campaign.enrollmentRequired ? '需要报名' : '无需报名'}</dd>
                <dt>转化率</dt><dd>${percent(performance.conversionRate)}（已发奖励 / 报名人数）</dd>
            </dl>

            ${campaign.status === 'DRAFT' ? `
            <div class="card" style="box-shadow:none">
                <h3>编辑规则 <span class="muted">仅草稿可编辑</span></h3>
                <form id="campaign-form">
                    ${campaignFormHtml(campaign)}
                    <div class="form-actions">
                        <button class="btn primary" type="submit" id="campaign-save">保存修改</button>
                    </div>
                    <div id="campaign-msg"></div>
                </form>
            </div>` : '<div class="alert info">活动已发布，规则不可再编辑；如需调整请新建活动。</div>'}
            <div class="form-actions"><a class="btn ghost" href="#/campaigns">返回列表</a></div>`;

        box.querySelectorAll('[data-transition]').forEach((button) => {
            button.addEventListener('click', async () => {
                setBusy(button, true, '处理中…');
                try {
                    await api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/${button.dataset.transition}`,
                        { method: 'POST' });
                    toast('操作成功', 'success');
                    await pageCampaignDetail(campaignId);
                } catch (error) {
                    toast(`${error.code || '操作失败'}：${error.message}`, 'error');
                    setBusy(button, false);
                }
            });
        });

        const form = document.getElementById('campaign-form');
        if (form) {
            const saveButton = document.getElementById('campaign-save');
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const msg = document.getElementById('campaign-msg');
                msg.innerHTML = '';
                setBusy(saveButton, true, '保存中…');
                try {
                    await api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`, {
                        method: 'PUT',
                        body: campaignPayload(form)
                    });
                    toast('活动已更新', 'success');
                    await pageCampaignDetail(campaignId);
                } catch (error) {
                    msg.innerHTML = errBox(error);
                    setBusy(saveButton, false);
                }
            });
        }
    } catch (error) {
        box.innerHTML = errBox(error);
    }
}

/* ---------------- 页面：用户管理 ---------------- */

const usersUi = { page: 0 };

function requireAdmin(active = 'users', title = '用户管理') {
    if (state.session.user.userType !== 'A') {
        shell({
            active,
            title,
            subtitle: '仅管理员可访问',
            content: '<div class="alert error">当前账号不是管理员，无法访问该页面。请使用 ADMIN001 登录。</div>'
        });
        return false;
    }
    return true;
}

function pageUsers() {
    if (!requireAdmin()) return;
    shell({
        active: 'users',
        title: '用户管理',
        subtitle: '维护登录用户与管理员（对应遗留 COUSR00C–03C）',
        content: `
            <div class="card">
                <div class="section-title">
                    <h3>用户列表</h3>
                    <a class="btn primary small" href="#/users/new">新增用户</a>
                </div>
                <div id="users-result"></div>
            </div>`
    });

    const box = document.getElementById('users-result');
    const load = async (page) => {
        usersUi.page = Math.max(0, page);
        box.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const result = await api(`/api/v1/users?page=${usersUi.page}&size=10`);
            const items = result.items || [];
            box.innerHTML = `
                ${items.length === 0 ? '<div class="empty">暂无用户</div>' : `
                <div class="table-wrap"><table class="table">
                    <thead><tr><th>用户号</th><th>姓名</th><th>类型</th><th>操作</th></tr></thead>
                    <tbody>${items.map((user) => `
                        <tr>
                            <td class="mono">${esc(user.userId)}</td>
                            <td>${esc(user.firstName)} ${esc(user.lastName)}</td>
                            <td>${userTypeBadge(user.userType)}</td>
                            <td class="actions">
                                <a class="btn ghost small" href="#/users/${encodeURIComponent(user.userId)}">编辑</a>
                                <button class="btn danger small" data-delete="${esc(user.userId)}">删除</button>
                            </td>
                        </tr>`).join('')}
                    </tbody></table></div>`}
                ${pager(usersUi.page, result.size || 10, result.total || 0)}`;

            box.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => load(usersUi.page + (button.dataset.page === 'next' ? 1 : -1)));
            });
            box.querySelectorAll('[data-delete]').forEach((button) => {
                button.addEventListener('click', async () => {
                    const userId = button.dataset.delete;
                    if (!window.confirm(`确认删除用户 ${userId}？`)) return;
                    setBusy(button, true, '删除中…');
                    try {
                        await api(`/api/v1/users/${encodeURIComponent(userId)}`, {
                            method: 'DELETE',
                            headers: { 'X-User-Id': state.session.user.userId }
                        });
                        toast('用户已删除', 'success');
                        await load(usersUi.page);
                    } catch (error) {
                        toast(`${error.code || '删除失败'}：${error.message}`, 'error');
                        setBusy(button, false);
                    }
                });
            });
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };
    load(usersUi.page);
}

function pageUserNew() {
    if (!requireAdmin()) return;
    shell({
        active: 'users',
        title: '新增用户',
        subtitle: '用户号 8 位字母数字，密码 8–64 位，类型 A/U',
        content: `
            <div class="card">
                <form id="user-form">
                    <div class="form-grid">
                        <label class="field"><span>用户号 <span class="req">*</span></span>
                            <input name="userId" value="USER0002" maxlength="8" pattern="[A-Za-z0-9]{8}" required></label>
                        <label class="field"><span>用户类型 <span class="req">*</span></span>
                            <select name="userType">
                                <option value="U">U · 普通用户</option>
                                <option value="A">A · 管理员</option>
                            </select></label>
                        <label class="field"><span>名 <span class="req">*</span></span>
                            <input name="firstName" value="Ada" maxlength="20" required></label>
                        <label class="field"><span>姓 <span class="req">*</span></span>
                            <input name="lastName" value="Lovelace" maxlength="20" required></label>
                        <label class="field span-2"><span>密码 <span class="req">*</span></span>
                            <input name="password" type="password" value="pass1234" minlength="8" maxlength="64" required></label>
                    </div>
                    <div class="form-actions">
                        <button class="btn primary" type="submit" id="user-save">创建用户</button>
                        <a class="btn ghost" href="#/users">返回列表</a>
                    </div>
                    <div id="user-msg"></div>
                </form>
            </div>`
    });

    const form = document.getElementById('user-form');
    const button = document.getElementById('user-save');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const msg = document.getElementById('user-msg');
        msg.innerHTML = '';
        setBusy(button, true, '创建中…');
        try {
            await api('/api/v1/users', {
                method: 'POST',
                body: {
                    userId: values.userId.trim().toUpperCase(),
                    firstName: values.firstName.trim(),
                    lastName: values.lastName.trim(),
                    password: values.password,
                    userType: values.userType
                }
            });
            toast('用户已创建', 'success');
            location.hash = '#/users';
        } catch (error) {
            msg.innerHTML = errBox(error);
            setBusy(button, false);
        }
    });
}

async function pageUserEdit(userId) {
    if (!requireAdmin()) return;
    shell({
        active: 'users',
        title: '编辑用户',
        subtitle: `用户号 ${userId}`,
        content: '<div class="card" id="user-edit"><div class="empty">加载中…</div></div>'
    });
    const box = document.getElementById('user-edit');
    try {
        const user = await api(`/api/v1/users/${encodeURIComponent(userId)}`);
        box.innerHTML = `
            <form id="user-form">
                <div class="form-grid">
                    <label class="field"><span>用户号</span>
                        <input value="${esc(user.userId)}" disabled></label>
                    <label class="field"><span>用户类型 <span class="req">*</span></span>
                        <select name="userType">
                            <option value="U" ${user.userType === 'U' ? 'selected' : ''}>U · 普通用户</option>
                            <option value="A" ${user.userType === 'A' ? 'selected' : ''}>A · 管理员</option>
                        </select></label>
                    <label class="field"><span>名 <span class="req">*</span></span>
                        <input name="firstName" value="${esc(user.firstName)}" maxlength="20" required></label>
                    <label class="field"><span>姓 <span class="req">*</span></span>
                        <input name="lastName" value="${esc(user.lastName)}" maxlength="20" required></label>
                    <label class="field span-2"><span>新密码（留空则不修改）</span>
                        <input name="password" type="password" minlength="8" maxlength="64" placeholder="至少 8 位"></label>
                </div>
                <div class="form-actions">
                    <button class="btn primary" type="submit" id="user-save">保存修改</button>
                    <a class="btn ghost" href="#/users">返回列表</a>
                </div>
                <div id="user-msg"></div>
            </form>`;

        const form = document.getElementById('user-form');
        const button = document.getElementById('user-save');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const values = formValues(form);
            const body = {
                firstName: values.firstName.trim(),
                lastName: values.lastName.trim(),
                userType: values.userType
            };
            if (values.password) body.password = values.password;
            const msg = document.getElementById('user-msg');
            msg.innerHTML = '';
            setBusy(button, true, '保存中…');
            try {
                await api(`/api/v1/users/${encodeURIComponent(userId)}`, { method: 'PUT', body });
                toast('用户已更新', 'success');
                location.hash = '#/users';
            } catch (error) {
                msg.innerHTML = errBox(error);
                setBusy(button, false);
            }
        });
    } catch (error) {
        box.innerHTML = errBox(error);
    }
}

/* ---------------- 页面：我的分期 / 分期申请 / 分期详情 ---------------- */

function hashQuery() {
    const hash = location.hash || '';
    const index = hash.indexOf('?');
    return new URLSearchParams(index < 0 ? '' : hash.slice(index + 1));
}

function planStatusBadge(status) {
    if (status === 'ACTIVE') return '<span class="badge ok">ACTIVE</span>';
    if (status === 'SETTLED') return '<span class="badge">SETTLED</span>';
    if (status === 'CANCELLED') return '<span class="badge warn">CANCELLED</span>';
    return esc(status);
}

function pageInstallments() {
    shell({
        active: 'installments',
        title: '我的分期',
        subtitle: '消费/账单分期列表、还款计划与提前结清（REQ-INS-05）',
        content: `
            <div class="card">
                <form class="inline-form" id="ins-filter">
                    <label class="field"><span>账户号（11 位）</span>
                        <input id="ins-account" value="00000000006" maxlength="11" pattern="\\d{11}" required></label>
                    <label class="field"><span>状态</span>
                        <select id="ins-status">
                            <option value="">全部</option>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="SETTLED">SETTLED</option>
                            <option value="CANCELLED">CANCELLED</option>
                        </select></label>
                    <label class="field"><span>每页</span>
                        <input id="ins-size" type="number" min="1" max="100" value="20"></label>
                    <button class="btn primary" type="submit">查询</button>
                    <a class="btn ghost" href="#/installments/new?sourceType=TRANSACTION">申请消费分期</a>
                    <a class="btn ghost" href="#/installments/new?sourceType=BILL">申请账单分期</a>
                </form>
                <div id="ins-result"></div>
                <div id="ins-pager" class="form-actions"></div>
            </div>`
    });

    const result = document.getElementById('ins-result');
    const pager = document.getElementById('ins-pager');
    let page = 1;

    const load = async () => {
        const accountId = document.getElementById('ins-account').value.trim();
        const status = document.getElementById('ins-status').value;
        const size = document.getElementById('ins-size').value || 20;
        result.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const params = new URLSearchParams({ accountId, page: String(page), size: String(size) });
            if (status) params.set('status', status);
            const data = await api(`/api/v1/installments?${params.toString()}`);
            if (!data.items.length) {
                result.innerHTML = '<div class="empty">暂无分期计划</div>';
                pager.innerHTML = '';
                return;
            }
            result.innerHTML = `
                <div class="table-wrap"><table class="table">
                    <thead><tr><th>计划号</th><th>来源</th><th>本金</th><th>期数</th><th>总手续费</th>
                        <th>剩余本金</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
                    <tbody>${data.items.map((plan) => `
                        <tr>
                            <td class="mono">${esc(plan.planId)}</td>
                            <td>${esc(plan.sourceType)}<div class="hint mono">${esc(plan.sourceId)}</div></td>
                            <td class="num mono">${money(plan.principal)}</td>
                            <td>${plan.termMonths}</td>
                            <td class="num mono">${money(plan.totalFee)}</td>
                            <td class="num mono">${money(plan.remainingPrincipal)}</td>
                            <td>${planStatusBadge(plan.status)}</td>
                            <td class="nowrap">${dateTimeText(plan.createdAt)}</td>
                            <td><a class="btn ghost small" href="#/installments/${encodeURIComponent(plan.planId)}">详情</a></td>
                        </tr>`).join('')}
                    </tbody></table></div>
                <div class="hint mt-16">共 ${data.total} 条，第 ${data.page} 页</div>`;
            const canPrev = data.page > 1;
            const canNext = data.page * data.size < data.total;
            pager.innerHTML = `
                <button class="btn ghost" id="ins-prev" ${canPrev ? '' : 'disabled'}>上一页</button>
                <button class="btn ghost" id="ins-next" ${canNext ? '' : 'disabled'}>下一页</button>`;
            document.getElementById('ins-prev').addEventListener('click', () => { page -= 1; load(); });
            document.getElementById('ins-next').addEventListener('click', () => { page += 1; load(); });
        } catch (error) {
            result.innerHTML = errBox(error);
            pager.innerHTML = '';
        }
    };

    document.getElementById('ins-filter').addEventListener('submit', (event) => {
        event.preventDefault();
        page = 1;
        load();
    });
    load();
}

function pageInstallmentNew() {
    const query = hashQuery();
    const sourceType = query.get('sourceType') === 'BILL' ? 'BILL' : 'TRANSACTION';
    const accountId = query.get('accountId') || '00000000006';
    const sourceId = query.get('sourceId') || '';
    const amount = query.get('amount') || '';
    const previewKey = 'installment-preview';

    shell({
        active: 'installments',
        title: '申请分期',
        subtitle: '三步：选择期数 → 试算 → 确认提交（REQ-INS-03/04）',
        content: `
            <div class="card">
                <h3>① 分期信息</h3>
                <form id="ins-new-form">
                    <div class="grid cols-2">
                        <label class="field"><span>账户号（11 位）</span>
                            <input name="accountId" value="${esc(accountId)}" maxlength="11" pattern="\\d{11}" required></label>
                        <label class="field"><span>来源类型</span>
                            <select name="sourceType">
                                <option value="TRANSACTION" ${sourceType === 'TRANSACTION' ? 'selected' : ''}>TRANSACTION 单笔消费</option>
                                <option value="BILL" ${sourceType === 'BILL' ? 'selected' : ''}>BILL 当期账单</option>
                            </select></label>
                        <label class="field span-2"><span>来源 ID（交易号 16 位 / 账单号）</span>
                            <input name="sourceId" value="${esc(sourceId)}" maxlength="32" required></label>
                        <label class="field"><span>分期本金</span>
                            <input name="principal" type="number" step="0.01" min="0.01" value="${esc(amount)}" required></label>
                        <label class="field"><span>期数</span>
                            <select name="termMonths">
                                <option value="3">3 期（0.60%/月）</option>
                                <option value="6" selected>6 期（0.55%/月）</option>
                                <option value="12">12 期（0.50%/月）</option>
                            </select></label>
                    </div>
                    <div class="form-actions">
                        <button class="btn primary" type="submit" id="ins-preview-btn">试算</button>
                        <a class="btn ghost" href="#/installments">返回我的分期</a>
                    </div>
                    <div id="ins-preview-msg"></div>
                </form>
            </div>
            <div class="card mt-16" id="ins-preview-box" hidden></div>`
    });

    const form = document.getElementById('ins-new-form');
    const box = document.getElementById('ins-preview-box');
    const msg = document.getElementById('ins-preview-msg');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        msg.innerHTML = '';
        const values = formValues(form);
        const body = {
            accountId: values.accountId.trim(),
            sourceType: values.sourceType,
            sourceId: values.sourceId.trim(),
            principal: Number(values.principal),
            termMonths: Number(values.termMonths)
        };
        const button = document.getElementById('ins-preview-btn');
        setBusy(button, true, '试算中…');
        try {
            const preview = await api('/api/v1/installments/preview', { method: 'POST', body });
            sessionStorage.setItem(previewKey, JSON.stringify({ request: body, preview }));
            box.hidden = false;
            box.innerHTML = `
                <h3>② 试算结果</h3>
                <div class="grid cols-3">
                    <div class="stat"><div class="label">月手续费率</div><div class="value">${preview.monthlyFeeRate}</div></div>
                    <div class="stat"><div class="label">总手续费</div><div class="value">${money(preview.totalFee)}</div></div>
                    <div class="stat"><div class="label">首期合计</div><div class="value">${money(preview.firstPeriodTotal)}</div></div>
                </div>
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>期序</th><th>本金</th><th>手续费</th><th>本期合计</th></tr></thead>
                    <tbody>${preview.periods.map((period) => `
                        <tr><td>${period.installmentNo}</td>
                            <td class="num mono">${money(period.principal)}</td>
                            <td class="num mono">${money(period.fee)}</td>
                            <td class="num mono">${money(Number(period.principal) + Number(period.fee))}</td></tr>`).join('')}
                    </tbody></table></div>
                <h3 class="mt-16">③ 确认提交</h3>
                <label class="checkbox"><input type="checkbox" id="ins-agreement"> 我已阅读并同意《信用卡分期协议》</label>
                <div class="form-actions">
                    <button class="btn primary" id="ins-submit">提交分期</button>
                    <button class="btn ghost" id="ins-repreview">重新试算</button>
                </div>
                <div id="ins-submit-msg"></div>`;
            document.getElementById('ins-repreview').addEventListener('click', () => {
                sessionStorage.removeItem(previewKey);
                box.hidden = true;
                box.innerHTML = '';
            });
            document.getElementById('ins-submit').addEventListener('click', async () => {
                const submitMsg = document.getElementById('ins-submit-msg');
                submitMsg.innerHTML = '';
                if (!document.getElementById('ins-agreement').checked) {
                    submitMsg.innerHTML = '<div class="alert error">请先勾选分期协议</div>';
                    return;
                }
                const submitButton = document.getElementById('ins-submit');
                setBusy(submitButton, true, '提交中…');
                try {
                    const created = await api('/api/v1/installments', {
                        method: 'POST',
                        body: {
                            idempotencyKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
                            accountId: body.accountId,
                            sourceType: body.sourceType,
                            sourceId: body.sourceId,
                            principal: body.principal,
                            termMonths: body.termMonths,
                            previewToken: preview.previewToken,
                            agreementAccepted: true
                        }
                    });
                    toast(`分期已创建：${created.planId}`, 'success');
                    location.hash = `#/installments/${encodeURIComponent(created.planId)}`;
                } catch (error) {
                    submitMsg.innerHTML = errBox(error);
                } finally {
                    setBusy(submitButton, false);
                }
            });
        } catch (error) {
            sessionStorage.removeItem(previewKey);
            box.hidden = true;
            msg.innerHTML = errBox(error);
        } finally {
            setBusy(button, false);
        }
    });
}

function pageInstallmentDetail(planId) {
    shell({
        active: 'installments',
        title: '分期详情',
        subtitle: `计划号 ${planId}`,
        content: '<div class="card" id="ins-detail"><div class="empty">加载中…</div></div>'
    });
    const box = document.getElementById('ins-detail');

    const load = async () => {
        try {
            const plan = await api(`/api/v1/installments/${encodeURIComponent(planId)}`);
            const scheduleTotal = plan.schedules.reduce(
                (sum, row) => sum + Number(row.totalDue), 0);
            box.innerHTML = `
                ${plan.warning ? `<div class="alert error">还款计划不完整（${esc(plan.warning)}），请联系客服</div>` : ''}
                <div class="grid cols-3">
                    <div class="stat"><div class="label">本金 / 期数</div>
                        <div class="value">${money(plan.principal)} / ${plan.termMonths}</div></div>
                    <div class="stat"><div class="label">剩余本金</div>
                        <div class="value">${money(plan.remainingPrincipal)}</div></div>
                    <div class="stat"><div class="label">状态</div>
                        <div class="value">${planStatusBadge(plan.status)}</div></div>
                </div>
                <dl class="dl mt-16">
                    <dt>来源</dt><dd>${esc(plan.sourceType)} · <span class="mono">${esc(plan.sourceId)}</span></dd>
                    <dt>月费率 / 总手续费</dt><dd>${plan.monthlyFeeRate} / ${money(plan.totalFee)}</dd>
                    <dt>创建 / 结清时间</dt><dd>${dateTimeText(plan.createdAt)} / ${plan.settledAt ? dateTimeText(plan.settledAt) : '—'}</dd>
                    <dt>还款计划合计</dt><dd class="mono">${money(scheduleTotal)}</dd>
                </dl>
                <div class="table-wrap mt-16"><table class="table">
                    <thead><tr><th>期序</th><th>应还日期</th><th>本金</th><th>手续费</th><th>合计</th><th>状态</th></tr></thead>
                    <tbody>${plan.schedules.map((row) => `
                        <tr><td>${row.installmentNo}</td>
                            <td>${dateText(row.dueDate)}</td>
                            <td class="num mono">${money(row.principalDue)}</td>
                            <td class="num mono">${money(row.feeDue)}</td>
                            <td class="num mono">${money(row.totalDue)}</td>
                            <td>${esc(row.status)}</td></tr>`).join('')}
                    </tbody></table></div>
                ${plan.status === 'ACTIVE' ? `
                <h3 class="mt-16">提前结清</h3>
                <p class="hint">结清金额 = 剩余本金 + 剩余本金 1% 违约金 − 手续费减免（本轮减免 0.00）。</p>
                <div class="form-actions">
                    <button class="btn primary" id="ins-settle">计算并结清</button>
                    <a class="btn ghost" href="#/installments">返回我的分期</a>
                </div>
                <div id="ins-settle-msg"></div>` : `
                <div class="form-actions"><a class="btn ghost" href="#/installments">返回我的分期</a></div>`}`;

            const settleButton = document.getElementById('ins-settle');
            if (settleButton) {
                settleButton.addEventListener('click', async () => {
                    const settleMsg = document.getElementById('ins-settle-msg');
                    settleMsg.innerHTML = '';
                    setBusy(settleButton, true, '结清中…');
                    try {
                        const result = await api(`/api/v1/installments/${encodeURIComponent(planId)}/early-settlement`, {
                            method: 'POST',
                            body: {
                                settlementIdempotencyKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
                                feeRebate: 0
                            }
                        });
                        toast('分期已结清', 'success');
                        settleMsg.innerHTML = `<div class="alert success">
                            结清金额 ${money(result.settlementTotal)}（本金 ${money(result.remainingPrincipal)}
                            + 违约金 ${money(result.penaltyFee)} − 减免 ${money(result.feeRebate)}）</div>`;
                        await load();
                    } catch (error) {
                        settleMsg.innerHTML = errBox(error);
                    } finally {
                        setBusy(settleButton, false);
                    }
                });
            }
        } catch (error) {
            box.innerHTML = errBox(error);
        }
    };
    load();
}

/* ---------------- 页面：分期后台 ---------------- */

function pageAdminInstallments() {
    shell({
        active: 'admin-installments',
        title: '分期后台',
        subtitle: '跨账户查询与 30 天 CSV 导出（REQ-INS-07 / US-008）',
        content: `
            <div class="card">
                <form class="inline-form" id="admin-ins-filter">
                    <label class="field"><span>账户号（可选）</span>
                        <input id="admin-ins-account" maxlength="11" placeholder="00000000006"></label>
                    <label class="field"><span>状态</span>
                        <select id="admin-ins-status">
                            <option value="">全部</option>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="SETTLED">SETTLED</option>
                        </select></label>
                    <button class="btn primary" type="submit">查询</button>
                    <button class="btn ghost" type="button" id="admin-ins-export">导出 30 天 CSV</button>
                </form>
                <div id="admin-ins-export-msg"></div>
                <div id="admin-ins-result"></div>
            </div>`
    });

    const result = document.getElementById('admin-ins-result');

    const load = async () => {
        const accountId = document.getElementById('admin-ins-account').value.trim();
        const status = document.getElementById('admin-ins-status').value;
        const params = new URLSearchParams({ page: '1', size: '50' });
        if (accountId) params.set('accountId', accountId);
        if (status) params.set('status', status);
        result.innerHTML = '<div class="empty">加载中…</div>';
        try {
            const data = await api(`/api/v1/admin/installments?${params.toString()}`);
            result.innerHTML = data.items.length === 0
                ? '<div class="empty">暂无数据</div>'
                : `<div class="table-wrap"><table class="table">
                    <thead><tr><th>计划号</th><th>账户</th><th>本金</th><th>期数</th><th>剩余本金</th><th>状态</th><th>创建时间</th></tr></thead>
                    <tbody>${data.items.map((plan) => `
                        <tr><td class="mono">${esc(plan.planId)}</td>
                            <td class="mono">${esc(plan.accountId)}</td>
                            <td class="num mono">${money(plan.principal)}</td>
                            <td>${plan.termMonths}</td>
                            <td class="num mono">${money(plan.remainingPrincipal)}</td>
                            <td>${planStatusBadge(plan.status)}</td>
                            <td class="nowrap">${dateTimeText(plan.createdAt)}</td></tr>`).join('')}
                    </tbody></table></div>
                <div class="hint mt-16">共 ${data.total} 条</div>`;
        } catch (error) {
            result.innerHTML = errBox(error);
        }
    };

    document.getElementById('admin-ins-filter').addEventListener('submit', (event) => {
        event.preventDefault();
        load();
    });
    document.getElementById('admin-ins-export').addEventListener('click', async () => {
        const exportMsg = document.getElementById('admin-ins-export-msg');
        exportMsg.innerHTML = '';
        try {
            const ticket = await api('/api/v1/admin/installments/exports?days=30', { method: 'POST' });
            exportMsg.innerHTML = `<div class="alert success">
                导出已生成：${ticket.rowCount} 行，24 小时内可下载。
                <a href="/api/v1/admin/installments/exports/${encodeURIComponent(ticket.exportId)}">下载 CSV</a></div>`;
            toast('导出已生成', 'success');
        } catch (error) {
            exportMsg.innerHTML = errBox(error);
        }
    });
    load();
}

/* ---------------- 路由 ---------------- */

function pageNotFound() {
    shell({
        active: '',
        title: '页面不存在',
        subtitle: '',
        content: '<div class="card"><div class="empty">没有找到该页面。<br><a href="#/menu">返回首页</a></div></div>'
    });
}

function route() {
    loadSession();
    const hash = location.hash || '#/menu';
    const queryIndex = hash.indexOf('?');
    const path = (queryIndex < 0 ? hash : hash.slice(0, queryIndex)).replace(/^#/, '');
    const segments = path.split('/').filter(Boolean);

    if (!state.session) {
        if (path !== '/login') {
            location.hash = '#/login';
            return;
        }
        pageLogin();
        return;
    }
    if (path === '/login') {
        location.hash = '#/menu';
        return;
    }

    if (segments.length === 0 || segments[0] === 'menu') return pageMenu();
    if (segments[0] === 'accounts') return pageAccounts();
    if (segments[0] === 'cards') {
        return segments[1] ? pageCardDetail(segments[1]) : pageCards();
    }
    if (segments[0] === 'transactions') {
        if (segments[1] === 'new') return pageTransactionNew();
        return segments[1] ? pageTransactionDetail(segments[1]) : pageTransactions();
    }
    if (segments[0] === 'installments') {
        if (segments[1] === 'new') return pageInstallmentNew();
        return segments[1] ? pageInstallmentDetail(segments[1]) : pageInstallments();
    }
    if (segments[0] === 'admin' && segments[1] === 'installments') return pageAdminInstallments();
    if (segments[0] === 'bill-pay') return pageBillPay();
    if (segments[0] === 'reports') return pageReports();
    if (segments[0] === 'authorizations') return pageAuthorizations();
    if (segments[0] === 'offers') return pageOffers();
    if (segments[0] === 'rewards') return pageRewards();
    if (segments[0] === 'campaigns') {
        if (segments[1] === 'new') return pageCampaignNew();
        return segments[1] ? pageCampaignDetail(segments[1]) : pageCampaigns();
    }
    if (segments[0] === 'users') {
        if (segments[1] === 'new') return pageUserNew();
        return segments[1] ? pageUserEdit(segments[1]) : pageUsers();
    }
    return pageNotFound();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
