import { auth, db } from './config.js';
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
    ref, set, push, onValue, runTransaction, get, remove, update
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// ── Globals ──
let currentUser = null;
let currentUserRole = 'user';
let ordersData = {};
let currentEditOrderId = null;
let ordersChart = null;
let usersData = {};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    addItemRow();
    setupEventListeners();
    initializeCharts();
    createToastContainer();
});

function createToastContainer() {
    if (!document.getElementById('toast-container')) {
        const tc = document.createElement('div');
        tc.id = 'toast-container';
        document.body.appendChild(tc);
    }
}

// ── TOAST SYSTEM ──
window.showToast = function(type, title, msg = '', duration = 4000) {
    const icons = { success:'check_circle', error:'error', warning:'warning', info:'info' };
    const tc = document.getElementById('toast-container');
    if (!tc) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="material-icons toast-icon">${icons[type] || 'info'}</span>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    tc.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('exiting');
        setTimeout(() => toast.remove(), 250);
    }, duration);
};

// ── CONFIRM DIALOG ──
function showConfirm({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warn' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-box">
                <div class="confirm-icon ${type}">
                    <span class="material-icons">${type === 'danger' ? 'delete_forever' : 'help_outline'}</span>
                </div>
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="confirm-btns">
                    <button class="btn-secondary" id="cfm-cancel">${cancelText}</button>
                    <button class="btn-${type === 'danger' ? 'danger' : 'primary'}" id="cfm-ok">${confirmText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#cfm-cancel').onclick = () => { overlay.remove(); resolve(false); };
        overlay.querySelector('#cfm-ok').onclick    = () => { overlay.remove(); resolve(true); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
}

function setupEventListeners() {
    const ivaInput       = document.getElementById('iva-percent');
    const retefuenteInput = document.getElementById('retefuente');
    const reteicaInput   = document.getElementById('reteica');
    const searchInput    = document.getElementById('search-orders');
    const filterType     = document.getElementById('filter-type');
    const filterDate     = document.getElementById('filter-date');
    if (ivaInput)        ivaInput.addEventListener('input', calculateTotals);
    if (retefuenteInput) retefuenteInput.addEventListener('input', calculateTotals);
    if (reteicaInput)    reteicaInput.addEventListener('input', calculateTotals);
    if (searchInput)     searchInput.addEventListener('input', filterOrders);
    if (filterType)      filterType.addEventListener('change', filterOrders);
    if (filterDate)      filterDate.addEventListener('change', filterOrders);
}

// ── AUTH ──
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email    = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errEl    = document.getElementById('login-error');
        const btn      = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons">hourglass_empty</span> Ingresando...';

        signInWithEmailAndPassword(auth, email, password)
            .catch((error) => {
                const msgs = {
                    'auth/user-not-found':   'Usuario no encontrado',
                    'auth/wrong-password':   'Contraseña incorrecta',
                    'auth/invalid-email':    'Email inválido',
                    'auth/too-many-requests':'Demasiados intentos. Intenta más tarde',
                };
                errEl.textContent = msgs[error.code] || error.message;
                btn.disabled = false;
                btn.innerHTML = '<span class="material-icons">login</span> Ingresar al Sistema';
            });
    });
}

window.logout = async function() {
    const ok = await showConfirm({ title: '¿Cerrar sesión?', message: 'Tu sesión será cerrada.', confirmText: 'Salir', type: 'warn' });
    if (ok) signOut(auth);
};

async function checkUserRole(user) {
    try {
        const userRef  = ref(db, `usuarios/${user.uid}`);
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
            const userData = snapshot.val();
            currentUserRole = userData.rol || 'user';
            if (userData.activo === false) {
                await signOut(auth);
                showToast('error', 'Acceso denegado', 'Usuario inactivo. Contacta al administrador.');
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('app-view').classList.add('hidden');
                return;
            }
            currentUser = { uid: user.uid, email: user.email, ...userData };
            const uName = document.getElementById('user-name');
            const uRole = document.getElementById('user-role');
            if (uName) uName.textContent = userData.nombre || user.email;
            if (uRole) uRole.textContent = currentUserRole === 'admin' ? 'Administrador' : 'Usuario';
        } else {
            await signOut(auth);
            showToast('error', 'Acceso denegado', 'Este usuario no está registrado en el sistema.');
            document.getElementById('login-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
            return;
        }
        updateUIForRole();
        if (currentUserRole === 'admin') loadUsers();
    } catch (error) {
        console.error('Error verificando rol:', error);
        currentUserRole = 'user';
    }
}

function updateUIForRole() {
    const isAdmin = currentUserRole === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? 'inline-flex' : 'none';
    });
}

function checkAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await checkUserRole(user);
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('app-view').classList.remove('hidden');
            showLoadingIndicator();
            try {
                await loadOrdersWithPromise();
                await loadDashboardDataWithPromise();
                hideLoadingIndicator();
                showSection('dashboard-section');
            } catch (error) {
                console.error('Error en carga inicial:', error);
                hideLoadingIndicator();
                showToast('error', 'Error de carga', 'No se pudieron cargar los datos. Recarga la página.');
            }
        } else {
            currentUser = null;
            currentUserRole = 'user';
            document.getElementById('login-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
        }
    });
}

// ── LOAD ORDERS ──
function loadOrdersWithPromise() {
    return new Promise((resolve, reject) => {
        const ordersRef = ref(db, 'ordenes');
        const timeout   = setTimeout(() => reject(new Error('Timeout')), 10000);
        get(ordersRef).then((snapshot) => {
            clearTimeout(timeout);
            const tbody = document.getElementById('orders-body');
            const data  = snapshot.val();
            if (!data) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No hay órdenes registradas</td></tr>';
                ordersData = {};
            } else {
                ordersData = data;
                filterOrders();
            }
            resolve(ordersData);
        }).catch(error => { clearTimeout(timeout); reject(error); });
    });
}

// ── DASHBOARD ──
function loadDashboardDataWithPromise() {
    return new Promise((resolve, reject) => {
        if (!ordersData || Object.keys(ordersData).length === 0) {
            updateDashboardWithEmptyData(); resolve(); return;
        }
        try {
            const ordersArray   = Object.values(ordersData);
            const totalOrders   = ordersArray.length;
            const totalAmount   = ordersArray.reduce((s, o) => s + (o.totales?.total || 0), 0);
            const avgAmount     = totalOrders > 0 ? totalAmount / totalOrders : 0;
            const now           = new Date();
            const thisMonth     = ordersArray.filter(o => {
                if (!o.fecha) return false;
                const d = new Date(o.fecha);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length;
            const ordersByType  = {};
            ordersArray.forEach(o => {
                const t = o.tipoGasto || 'OTROS';
                ordersByType[t] = (ordersByType[t] || 0) + 1;
            });
            const last6Months   = getLast6Months();
            const monthlyData   = last6Months.map(m =>
                ordersArray
                    .filter(o => o.fecha && new Date(o.fecha).getMonth() === m.month && new Date(o.fecha).getFullYear() === m.year)
                    .reduce((s, o) => s + (o.totales?.total || 0), 0)
            );
            updateDashboardUI({ totalOrders, totalAmount, avgAmount, thisMonth, ordersByType, monthlyData, last6Months, ordersArray });
            resolve();
        } catch (e) { reject(e); }
    });
}

function updateDashboardUI({ totalOrders, totalAmount, avgAmount, thisMonth, ordersByType, monthlyData, last6Months, ordersArray }) {
    const fmt = v => v.toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-total-orders', totalOrders);
    set('stat-total-amount', fmt(totalAmount));
    set('stat-avg-amount',   fmt(avgAmount));
    set('stat-this-month',   thisMonth);

    const byTypeEl = document.getElementById('orders-by-type');
    if (byTypeEl) {
        byTypeEl.innerHTML = Object.keys(ordersByType).length > 0
            ? Object.entries(ordersByType).map(([t, c]) => `
                <div class="stat-item">
                    <span class="stat-label">${t}</span>
                    <span class="stat-value">${c}</span>
                </div>`).join('')
            : '<div class="stat-item"><span>Sin datos</span></div>';
    }

    if (ordersChart) {
        ordersChart.data.labels = last6Months.map(m => m.label);
        ordersChart.data.datasets[0].data = monthlyData;
        ordersChart.update();
    }

    const recentEl = document.getElementById('recent-orders');
    if (recentEl) {
        const recent = [...ordersArray].sort((a, b) => new Date(b.fecha||0) - new Date(a.fecha||0)).slice(0,5);
        recentEl.innerHTML = recent.length > 0
            ? recent.map(o => `
                <div class="recent-order-item">
                    <div>
                        <strong>#${o.numeroOrden}</strong> — ${o.proveedor?.razonSocial || 'N/A'}
                        <br><small>${o.fecha ? new Date(o.fecha).toLocaleDateString('es-CO') : ''}</small>
                    </div>
                    <div class="recent-order-amount">${fmt(o.totales?.total || 0)}</div>
                </div>`).join('')
            : '<div class="recent-order-item">Sin órdenes recientes</div>';
    }
}

function updateDashboardWithEmptyData() {
    ['stat-total-orders','stat-this-month'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='0'; });
    ['stat-total-amount','stat-avg-amount'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='$0'; });
    const byType = document.getElementById('orders-by-type');
    if (byType) byType.innerHTML = '<div class="stat-item"><span>Sin datos</span></div>';
    const recent = document.getElementById('recent-orders');
    if (recent) recent.innerHTML = '<div class="recent-order-item">Sin órdenes recientes</div>';
    if (ordersChart) { ordersChart.data.labels=[]; ordersChart.data.datasets[0].data=[]; ordersChart.update(); }
}

// ── NAVIGATION ──
window.showSection = function(sectionId) {
    document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
    const s = document.getElementById(sectionId);
    if (s) s.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick')?.includes(sectionId)) btn.classList.add('active');
    });
    if (sectionId === 'list-section') loadOrders();
    else if (sectionId === 'dashboard-section') {
        if (ordersData && Object.keys(ordersData).length > 0)
            loadDashboardDataWithPromise().catch(console.error);
        else {
            showLoadingIndicator();
            loadOrdersWithPromise().then(() => loadDashboardDataWithPromise()).then(hideLoadingIndicator).catch(console.error);
        }
    } else if (sectionId === 'admin-users-section' && currentUserRole === 'admin') loadUsers();
    else if (sectionId === 'create-section' && !currentEditOrderId) {
        getNextOrderNumber().then(n => {
            const el = document.getElementById('next-order-display');
            if (el) el.textContent = n;
        });
    }
};

window.refreshDashboard = function() {
    showLoadingIndicator();
    loadOrdersWithPromise().then(() => loadDashboardDataWithPromise()).then(() => { hideLoadingIndicator(); }).catch(() => { hideLoadingIndicator(); showToast('error','Error','No se pudo refrescar el dashboard.'); });
};

// ── LOADER ──
function showLoadingIndicator() {
    let l = document.getElementById('global-loader');
    if (!l) {
        l = document.createElement('div'); l.id = 'global-loader';
        l.innerHTML = '<div class="spinner"></div><p>Cargando datos...</p>';
        document.body.appendChild(l);
    }
    l.style.display = 'flex';
}
function hideLoadingIndicator() {
    const l = document.getElementById('global-loader');
    if (l) l.style.display = 'none';
}

// ── ITEMS ──
window.addItemRow = function(itemData = null) {
    const tbody = document.getElementById('items-body');
    if (!tbody) return;
    const rowId    = Date.now() + Math.floor(Math.random() * 1000);
    const rowCount = tbody.children.length + 1;
    const tr       = document.createElement('tr');
    tr.id = `row-${rowId}`;

    if (itemData) {
        tr.innerHTML = `
            <td style="color:var(--text-muted);font-family:'DM Mono',monospace;font-size:0.8rem;text-align:center">${rowCount}</td>
            <td><input type="text" class="item-desc" value="${itemData.descripcion || ''}" placeholder="Descripción del ítem" required></td>
            <td><input type="text" class="item-centro-costo" value="${itemData.centroCosto || ''}" placeholder="Centro de costo" required></td>
            <td><input type="number" class="item-qty" value="${itemData.cantidad || 1}" min="1" onchange="calculateRow('${rowId}')" oninput="calculateRow('${rowId}')"></td>
            <td><input type="number" class="item-price" value="${itemData.pUnit || 0}" min="0" step="1" onchange="calculateRow('${rowId}')" oninput="calculateRow('${rowId}')"></td>
            <td><span class="item-total">$${(itemData.total || 0).toLocaleString('es-CO')}</span></td>
            <td><button type="button" class="btn-remove" onclick="removeRow('${rowId}')" title="Eliminar ítem"><span class="material-icons">close</span></button></td>
        `;
        tr.dataset.total = itemData.total || 0;
    } else {
        tr.innerHTML = `
            <td style="color:var(--text-muted);font-family:'DM Mono',monospace;font-size:0.8rem;text-align:center">${rowCount}</td>
            <td><input type="text" class="item-desc" placeholder="Descripción del ítem" required></td>
            <td><input type="text" class="item-centro-costo" placeholder="Centro de costo"></td>
            <td><input type="number" class="item-qty" value="1" min="1" onchange="calculateRow('${rowId}')" oninput="calculateRow('${rowId}')"></td>
            <td><input type="number" class="item-price" value="0" min="0" step="1" onchange="calculateRow('${rowId}')" oninput="calculateRow('${rowId}')"></td>
            <td><span class="item-total">$0</span></td>
            <td><button type="button" class="btn-remove" onclick="removeRow('${rowId}')" title="Eliminar ítem"><span class="material-icons">close</span></button></td>
        `;
        tr.dataset.total = 0;
    }
    tbody.appendChild(tr);
    if (!itemData) calculateRow(rowId);
};

window.removeRow = async function(id) {
    const rows = document.querySelectorAll('#items-body tr');
    if (rows.length <= 1) { showToast('warning','Mínimo 1 ítem','Debe haber al menos un ítem en la orden.'); return; }
    const row = document.getElementById(`row-${id}`);
    if (row) { row.remove(); renumberRows(); calculateTotals(); }
};

function renumberRows() {
    document.querySelectorAll('#items-body tr').forEach((row, i) => {
        const cell = row.cells[0];
        if (cell) cell.textContent = i + 1;
    });
}

window.calculateRow = function(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;
    const qty    = parseFloat(row.querySelector('.item-qty')?.value)   || 0;
    const price  = parseFloat(row.querySelector('.item-price')?.value) || 0;
    const total  = qty * price;
    const span   = row.querySelector('.item-total');
    if (span) span.textContent = total.toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });
    row.dataset.total = total;
    calculateTotals();
};

window.calculateTotals = function() {
    let subtotal = 0;
    document.querySelectorAll('#items-body tr').forEach(row => { subtotal += parseFloat(row.dataset.total) || 0; });
    const ivaPercent  = parseFloat(document.getElementById('iva-percent')?.value)  || 0;
    const reteFuente  = parseFloat(document.getElementById('retefuente')?.value)   || 0;
    const reteIca     = parseFloat(document.getElementById('reteica')?.value)      || 0;
    const ivaValue    = subtotal * (ivaPercent / 100);
    const total       = subtotal + ivaValue - reteFuente - reteIca;
    const fmt = v => v.toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });
    const setEl = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v); };
    setEl('disp-subtotal', subtotal);
    setEl('disp-iva',      ivaValue);
    setEl('disp-total',    total);
    return { subtotal, ivaPercent, ivaValue, reteFuente, reteIca, total };
};

function validateItems() {
    const rows = document.querySelectorAll('#items-body tr');
    if (rows.length === 0) { showToast('warning','Sin ítems','Agrega al menos un ítem.'); return false; }
    for (const row of rows) {
        if (!row.querySelector('.item-desc')?.value.trim())       { showToast('warning','Campo requerido','Todos los ítems deben tener descripción.'); return false; }
        if (!row.querySelector('.item-centro-costo')?.value.trim()){ showToast('warning','Campo requerido','Todos los ítems deben tener centro de costo.'); return false; }
        if ((parseFloat(row.querySelector('.item-qty')?.value)||0) <= 0) { showToast('warning','Cantidad inválida','La cantidad debe ser mayor a 0.'); return false; }
        if ((parseFloat(row.querySelector('.item-price')?.value)||0) <= 0) { showToast('warning','Precio inválido','El precio unitario debe ser mayor a 0.'); return false; }
    }
    return true;
}

async function getNextOrderNumber() {
    try {
        const snap = await get(ref(db, 'metadata/lastOrderNumber'));
        return (snap.val() || 999) + 1;
    } catch { return '---'; }
}

// ── SAVE ORDER ──
const orderForm = document.getElementById('order-form');
if (orderForm) {
    orderForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) { showToast('error','Sin sesión','Debes estar autenticado.'); return; }
        if (!validateItems()) return;

        const totals = calculateTotals();
        const itemsData = [];
        document.querySelectorAll('#items-body tr').forEach((row, i) => {
            itemsData.push({
                numero:      i + 1,
                descripcion: row.querySelector('.item-desc').value,
                centroCosto: row.querySelector('.item-centro-costo')?.value || '',
                cantidad:    parseFloat(row.querySelector('.item-qty').value),
                pUnit:       parseFloat(row.querySelector('.item-price').value),
                total:       parseFloat(row.dataset.total)
            });
        });

        const tipoGasto = document.querySelector('input[name="tipoGasto"]:checked')?.value || 'COMPRA';
        const btn = e.target.querySelector('button[type="submit"]');
        btn.innerHTML = '<span class="material-icons">hourglass_empty</span> Guardando...';
        btn.disabled  = true;

        const proveedorData = {
            razonSocial: document.getElementById('prov-razon')?.value || '',
            nit:         document.getElementById('prov-nit')?.value   || '',
            direccion:   document.getElementById('prov-dir')?.value   || '',
            telefono:    document.getElementById('prov-tel')?.value   || '',
            correo:      document.getElementById('prov-email')?.value || ''
        };
        const compradorData = {
            razonSocial: 'Vehidiesel sas',
            nit:         '890113554-3',
            direccion:   'Barrio el bosque dg 21 45 112',
            telefono:    '6056620828',
            correo:      'Asistentecg@vehidiesel.com.co'
        };

        try {
            if (currentEditOrderId) {
                const orig = ordersData[currentEditOrderId];
                await update(ref(db, `ordenes/${currentEditOrderId}`), {
                    numeroOrden: orig.numeroOrden, fecha: orig.fecha,
                    comprador:   orig.comprador || compradorData,
                    autorizadoPor: document.getElementById('autorizado-por')?.value || '',
                    proveedor: proveedorData, tipoGasto, items: itemsData,
                    observaciones: document.getElementById('obs')?.value || '',
                    totales: totals, estado: orig.estado || 'ACTIVA',
                    creadoPor: orig.creadoPor,
                    ultimaModificacion: new Date().toISOString(),
                    editadoPor: { uid: currentUser.uid, email: currentUser.email, fecha: new Date().toISOString() }
                });
                showToast('success','Orden actualizada','Los cambios fueron guardados correctamente.');
                currentEditOrderId = null;
            } else {
                const counterRef = ref(db, 'metadata/lastOrderNumber');
                const result = await runTransaction(counterRef, v => (v || 999) + 1);
                const newNum  = result.snapshot.val();
                await set(push(ref(db, 'ordenes')), {
                    numeroOrden: newNum,
                    fecha: new Date().toISOString(),
                    comprador: compradorData,
                    autorizadoPor: document.getElementById('autorizado-por')?.value || '',
                    proveedor: proveedorData, tipoGasto, items: itemsData,
                    observaciones: document.getElementById('obs')?.value || '',
                    totales: totals, estado: 'ACTIVA',
                    creadoPor: { uid: currentUser.uid, email: currentUser.email, nombre: currentUser.nombre || currentUser.email },
                    ultimaModificacion: new Date().toISOString()
                });
                showToast('success','Orden guardada',`Orden #${newNum} creada exitosamente.`);
            }

            resetOrderForm();
            await loadOrdersWithPromise();
            await loadDashboardDataWithPromise();
            showSection('list-section');
        } catch (error) {
            console.error(error);
            showToast('error','Error al guardar', error.message);
        } finally {
            btn.innerHTML = '<span class="material-icons">save</span> Guardar Orden';
            btn.disabled  = false;
        }
    });
}

window.resetOrderForm = function() {
    document.getElementById('order-form')?.reset();
    document.getElementById('items-body').innerHTML = '';
    addItemRow();
    document.getElementById('iva-percent').value  = '19';
    document.getElementById('retefuente').value   = '0';
    document.getElementById('reteica').value      = '0';
    document.getElementById('autorizado-por').value = '';
    calculateTotals();
    currentEditOrderId = null;
    const btn = document.querySelector('#order-form button[type="submit"]');
    if (btn) btn.innerHTML = '<span class="material-icons">save</span> Guardar Orden';
    const disp = document.getElementById('next-order-display');
    if (disp) disp.textContent = '---';
    document.getElementById('form-title').innerHTML = '<span class="material-icons" style="vertical-align:-5px;font-size:20px;margin-right:6px;color:var(--primary);">add_shopping_cart</span>Generar Nueva Orden de Compra';
};

// ── EDIT ORDER ──
window.editOrder = function(orderId) {
    if (currentUserRole !== 'admin') { showToast('error','Sin permisos','Solo los administradores pueden editar órdenes.'); return; }
    const order = ordersData[orderId];
    if (!order) return;
    currentEditOrderId = orderId;

    document.getElementById('next-order-display').textContent = `${order.numeroOrden} (editando)`;
    document.getElementById('form-title').innerHTML = `<span class="material-icons" style="vertical-align:-5px;font-size:20px;margin-right:6px;color:var(--warning);">edit</span>Editando Orden #${order.numeroOrden}`;
    document.getElementById('autorizado-por').value = order.autorizadoPor || '';
    document.getElementById('prov-razon').value     = order.proveedor?.razonSocial || '';
    document.getElementById('prov-nit').value       = order.proveedor?.nit || '';
    document.getElementById('prov-dir').value       = order.proveedor?.direccion || '';
    document.getElementById('prov-tel').value       = order.proveedor?.telefono || '';
    document.getElementById('prov-email').value     = order.proveedor?.correo || '';

    document.querySelectorAll('input[name="tipoGasto"]').forEach(r => { if (r.value === order.tipoGasto) r.checked = true; });

    document.getElementById('items-body').innerHTML = '';
    (order.items?.length > 0 ? order.items : [null]).forEach(item => item ? addItemRow(item) : addItemRow());

    document.getElementById('iva-percent').value = order.totales?.ivaPercent || 19;
    document.getElementById('retefuente').value  = order.totales?.reteFuente || 0;
    document.getElementById('reteica').value     = order.totales?.reteIca    || 0;
    document.getElementById('obs').value         = order.observaciones || '';
    calculateTotals();
    showSection('create-section');
    const btn = document.querySelector('#order-form button[type="submit"]');
    if (btn) btn.innerHTML = '<span class="material-icons">update</span> Actualizar Orden';
};

// ── DELETE ORDER ──
window.deleteOrder = async function(orderId) {
    if (currentUserRole !== 'admin') { showToast('error','Sin permisos','Solo los administradores pueden eliminar órdenes.'); return; }
    const order = ordersData[orderId];
    const ok = await showConfirm({
        title: 'Eliminar Orden',
        message: `¿Estás seguro de eliminar la Orden #${order?.numeroOrden}? Esta acción no se puede deshacer.`,
        confirmText: 'Sí, eliminar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await remove(ref(db, `ordenes/${orderId}`));
        showToast('success','Orden eliminada','La orden fue eliminada correctamente.');
        await loadOrdersWithPromise();
        await loadDashboardDataWithPromise();
    } catch (error) {
        showToast('error','Error al eliminar', error.message);
    }
};

// ── LOAD & FILTER ORDERS ──
function loadOrders() {
    const ordersRef = ref(db, 'ordenes');
    onValue(ordersRef, (snapshot) => {
        const tbody = document.getElementById('orders-body');
        if (!tbody) return;
        const data = snapshot.val();
        if (!data) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No hay órdenes registradas</td></tr>';
            ordersData = {};
        } else {
            ordersData = data;
            filterOrders();
        }
        if (!document.getElementById('dashboard-section').classList.contains('hidden'))
            loadDashboardDataWithPromise().catch(console.error);
    });
}

function filterOrders() {
    const term = document.getElementById('search-orders')?.value.toLowerCase() || '';
    const type = document.getElementById('filter-type')?.value || '';
    const date = document.getElementById('filter-date')?.value || '';

    const arr = Object.entries(ordersData).map(([id, o]) => ({ id, ...o })).filter(o => {
        const matchSearch = !term ||
            o.proveedor?.razonSocial?.toLowerCase().includes(term) ||
            o.numeroOrden?.toString().includes(term) ||
            o.tipoGasto?.toLowerCase().includes(term) ||
            o.autorizadoPor?.toLowerCase().includes(term);
        const matchType = !type || o.tipoGasto === type;
        const matchDate = !date || !o.fecha || new Date(o.fecha).toISOString().split('T')[0] === date;
        return matchSearch && matchType && matchDate;
    }).sort((a, b) => new Date(b.fecha||0) - new Date(a.fecha||0));

    displayOrders(arr);
}

function displayOrders(orders) {
    const tbody = document.getElementById('orders-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No se encontraron órdenes</td></tr>';
        return;
    }
    const isAdmin = currentUserRole === 'admin';
    const fmt = v => v.toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });

    orders.forEach(o => {
        const tr   = document.createElement('tr');
        const dt   = o.fecha ? new Date(o.fecha) : null;
        const date = dt ? dt.toLocaleDateString('es-CO') : 'N/A';
        const time = dt ? dt.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' }) : '';

        tr.innerHTML = `
            <td style="color:var(--text-secondary)">
                <div>${date}</div>
                <div style="font-size:0.76rem;color:var(--text-muted)">${time}</div>
            </td>
            <td><span class="order-num">#${o.numeroOrden}</span></td>
            <td style="font-weight:500;color:var(--text-primary)">${o.proveedor?.razonSocial || 'N/A'}</td>
            <td><span class="status-badge activa">${o.tipoGasto || 'N/A'}</span></td>
            <td style="font-family:'DM Mono',monospace;font-weight:600;color:var(--success)">${fmt(o.totales?.total || 0)}</td>
            <td style="color:var(--text-muted);font-size:0.82rem">${o.creadoPor?.nombre || o.creadoPor?.email || 'N/A'}</td>
            <td>
                <div class="td-actions">
                    <button class="btn-icon btn-view"   onclick="viewOrderDetails('${o.id}')"    title="Ver detalles"><span class="material-icons">visibility</span></button>
                    <button class="btn-icon btn-print"  onclick="printOrder('${o.id}')"          title="Imprimir"><span class="material-icons">print</span></button>
                    <button class="btn-icon btn-pdf"    onclick="generatePDF('${o.id}')"         title="Descargar PDF"><span class="material-icons">picture_as_pdf</span></button>
                    ${isAdmin ? `
                    <button class="btn-icon btn-edit"   onclick="editOrder('${o.id}')"           title="Editar"><span class="material-icons">edit</span></button>
                    <button class="btn-icon btn-delete" onclick="deleteOrder('${o.id}')"         title="Eliminar"><span class="material-icons">delete</span></button>
                    ` : ''}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ── PRINT ORDER ──
function buildPrintDoc(order) {
    const fmt = v => (v||0).toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });
    const comp = order.comprador || { razonSocial:'Vehidiesel SAS', nit:'890113554-3', direccion:'Barrio el bosque dg 21 45 112', telefono:'6056620828', correo:'Asistentecg@vehidiesel.com.co' };
    const prov = order.proveedor || {};
    const items = order.items || [];
    const tot   = order.totales || {};
    const fecha = order.fecha ? new Date(order.fecha) : new Date();

    const itemsRows = items.map((item, i) => `
        <tr>
            <td>${i+1}</td>
            <td>${item.descripcion || ''}</td>
            <td>${item.centroCosto || ''}</td>
            <td style="text-align:center">${item.cantidad}</td>
            <td class="td-right">${fmt(item.pUnit)}</td>
            <td class="td-right">${fmt(item.total)}</td>
        </tr>
    `).join('');

    return `
        <div class="print-doc" id="print-doc-content">
            <div class="pd-header">
                <div class="pd-logo-area">
                    <img src="logo.png" alt="Vehidiesel" onerror="this.style.display='none'">
                    <div class="pd-company">VEHIDIESEL SAS</div>
                    <div style="font-size:10px;color:#666;margin-top:2px;">NIT: ${comp.nit} | ${comp.telefono}</div>
                    <div style="font-size:10px;color:#666;">${comp.correo}</div>
                </div>
                <div class="pd-order-info">
                    <div class="pd-order-label">Orden de Compra</div>
                    <div class="pd-order-num">#${order.numeroOrden}</div>
                    <div class="pd-meta">
                        <div>Fecha: <strong>${fecha.toLocaleDateString('es-CO')}</strong></div>
                        <div>Hora: ${fecha.toLocaleTimeString('es-CO', {hour:'2-digit',minute:'2-digit'})}</div>
                        <div>Tipo: <span class="pd-badge">${order.tipoGasto || 'COMPRA'}</span></div>
                    </div>
                </div>
            </div>

            <div class="pd-parties">
                <div class="pd-party">
                    <div class="pd-party-title">Comprador</div>
                    <p><strong>${comp.razonSocial}</strong></p>
                    <p>NIT: ${comp.nit}</p>
                    <p>${comp.direccion}</p>
                    <p>Tel: ${comp.telefono}</p>
                    <p>${comp.correo}</p>
                </div>
                <div class="pd-party">
                    <div class="pd-party-title">Proveedor</div>
                    <p><strong>${prov.razonSocial || 'N/A'}</strong></p>
                    <p>NIT: ${prov.nit || 'N/A'}</p>
                    <p>${prov.direccion || ''}</p>
                    ${prov.telefono ? `<p>Tel: ${prov.telefono}</p>` : ''}
                    ${prov.correo   ? `<p>${prov.correo}</p>`       : ''}
                </div>
            </div>

            ${order.autorizadoPor ? `<div style="background:#f7f9ff;border:1px solid #dde5ff;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;"><strong style="color:#1A56E8;">Autorizado por:</strong> ${order.autorizadoPor}</div>` : ''}

            <table class="pd-items-table">
                <thead>
                    <tr>
                        <th style="width:30px">#</th>
                        <th>Descripción</th>
                        <th>Centro de Costo</th>
                        <th style="width:60px;text-align:center">Cant.</th>
                        <th style="width:110px;text-align:right">P. Unitario</th>
                        <th style="width:110px;text-align:right">Total</th>
                    </tr>
                </thead>
                <tbody>${itemsRows}</tbody>
            </table>

            <div class="pd-totals">
                <div class="pd-totals-box">
                    <div class="pd-total-row"><span>Subtotal:</span><span>${fmt(tot.subtotal)}</span></div>
                    <div class="pd-total-row"><span>IVA (${tot.ivaPercent||0}%):</span><span>${fmt(tot.ivaValue)}</span></div>
                    <div class="pd-total-row"><span>Rete Fuente:</span><span>${fmt(tot.reteFuente)}</span></div>
                    <div class="pd-total-row"><span>Rete ICA:</span><span>${fmt(tot.reteIca)}</span></div>
                    <div class="pd-total-row grand"><span>TOTAL A PAGAR:</span><span>${fmt(tot.total)}</span></div>
                </div>
            </div>

            ${order.observaciones ? `
                <div class="pd-obs">
                    <div class="pd-obs-title">Observaciones</div>
                    <p style="font-size:10.5px;color:#555;">${order.observaciones}</p>
                </div>` : ''}

            <div class="pd-footer">
                <div>
                    <div>Creado por: ${order.creadoPor?.nombre || order.creadoPor?.email || 'N/A'}</div>
                    ${order.editadoPor ? `<div>Editado: ${new Date(order.editadoPor.fecha).toLocaleString('es-CO')}</div>` : ''}
                </div>
                <div style="display:flex;gap:24px;">
                    <div class="pd-sig">
                        <div class="pd-sig-line">Elaborado por</div>
                    </div>
                    <div class="pd-sig">
                        <div class="pd-sig-line">Autorizado por</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.printOrder = function(orderId) {
    const order = ordersData[orderId];
    if (!order) return;

    const printContent = buildPrintDoc(order);
    const printWindow  = window.open('', '_blank', 'width=900,height=700');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Orden #${order.numeroOrden} — Vehidiesel</title>
            <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
            <link rel="stylesheet" href="style.css">
            <style>
                body { background:#fff; overflow:auto; height:auto; }
                .print-doc { max-width:none; margin:0; padding:20px 28px; }
                @media print { @page { margin: 10mm 8mm; } }
            </style>
        </head>
        <body>
            ${printContent}
            <script>
                window.onload = function() {
                    setTimeout(function() { window.print(); }, 600);
                };
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// ── VIEW ORDER DETAILS ──
window.viewOrderDetails = function(orderId) {
    const order = ordersData[orderId];
    if (!order) return;
    const isAdmin = currentUserRole === 'admin';
    const fmt = v => (v||0).toLocaleString('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 });
    const comp = order.comprador || { razonSocial:'Vehidiesel SAS', nit:'890113554-3', direccion:'Barrio el bosque dg 21 45 112', telefono:'6056620828', correo:'Asistentecg@vehidiesel.com.co' };

    const itemsHtml = (order.items||[]).map(item => `
        <tr>
            <td style="padding:8px 10px;color:var(--text-muted);font-family:'DM Mono',monospace;font-size:0.78rem">${item.numero||''}</td>
            <td style="padding:8px 10px;color:var(--text-primary)">${item.descripcion||''}</td>
            <td style="padding:8px 10px;color:var(--text-secondary)">${item.centroCosto||''}</td>
            <td style="padding:8px 10px;text-align:center;color:var(--text-secondary)">${item.cantidad||0}</td>
            <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--text-secondary)">${fmt(item.pUnit)}</td>
            <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:var(--success)">${fmt(item.total)}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="padding:12px;text-align:center;color:var(--text-muted);">Sin ítems</td></tr>';

    const html = `
        <div class="modal-header">
            <h3>
                <span class="material-icons" style="vertical-align:-4px;font-size:18px;margin-right:6px;color:var(--primary);">receipt_long</span>
                Orden de Compra <span style="font-family:'DM Mono',monospace;color:var(--primary)">#${order.numeroOrden}</span>
            </h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div class="info-card">
                    <h4>Comprador</h4>
                    <p><strong>${comp.razonSocial}</strong></p>
                    <p>NIT: ${comp.nit}</p>
                    <p>${comp.direccion}</p>
                    <p>Tel: ${comp.telefono}</p>
                    <p>${comp.correo}</p>
                </div>
                <div class="info-card">
                    <h4>Proveedor</h4>
                    <p><strong>${order.proveedor?.razonSocial||'N/A'}</strong></p>
                    <p>NIT: ${order.proveedor?.nit||'N/A'}</p>
                    <p>${order.proveedor?.direccion||''}</p>
                    ${order.proveedor?.telefono ? `<p>Tel: ${order.proveedor.telefono}</p>` : ''}
                    ${order.proveedor?.correo   ? `<p>${order.proveedor.correo}</p>` : ''}
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div class="info-card">
                    <h4>Información General</h4>
                    <p><strong>Tipo:</strong> ${order.tipoGasto||'N/A'}</p>
                    <p><strong>Autorizado por:</strong> ${order.autorizadoPor||'—'}</p>
                    <p><strong>Creado por:</strong> ${order.creadoPor?.nombre||order.creadoPor?.email||'N/A'}</p>
                    <p><strong>Estado:</strong> <span class="status-badge activa">${order.estado||'ACTIVA'}</span></p>
                </div>
                <div class="info-card">
                    <h4>Fechas</h4>
                    <p><strong>Creación:</strong> ${order.fecha ? new Date(order.fecha).toLocaleString('es-CO') : 'N/A'}</p>
                    ${order.ultimaModificacion ? `<p><strong>Últ. modificación:</strong> ${new Date(order.ultimaModificacion).toLocaleString('es-CO')}</p>` : ''}
                    ${order.editadoPor ? `<p><strong>Editado por:</strong> ${order.editadoPor.email}</p>` : ''}
                </div>
            </div>

            <div class="info-card" style="margin-bottom:14px;">
                <h4>Ítems de la Orden</h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                        <thead>
                            <tr style="background:var(--navy);border-bottom:1px solid var(--navy-border);">
                                <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">#</th>
                                <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">Descripción</th>
                                <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">Centro Costo</th>
                                <th style="padding:8px 10px;text-align:center;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">Cant.</th>
                                <th style="padding:8px 10px;text-align:right;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">P. Unitario</th>
                                <th style="padding:8px 10px;text-align:right;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:600">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
            </div>

            <div class="info-card" style="margin-bottom:14px;">
                <h4>Resumen Financiero</h4>
                <div style="display:flex;justify-content:flex-end;">
                    <div style="min-width:240px;">
                        ${[
                            ['Subtotal', fmt(order.totales?.subtotal)],
                            [`IVA (${order.totales?.ivaPercent||0}%)`, fmt(order.totales?.ivaValue)],
                            ['Rete Fuente', fmt(order.totales?.reteFuente)],
                            ['Rete ICA', fmt(order.totales?.reteIca)]
                        ].map(([l,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--navy-border);font-size:0.86rem;color:var(--text-secondary)"><span>${l}</span><span style="font-family:'DM Mono',monospace">${v}</span></div>`).join('')}
                        <div style="display:flex;justify-content:space-between;padding:10px 0 4px;font-weight:700;font-size:1rem;color:var(--success);border-top:1px solid var(--primary);margin-top:6px;"><span>TOTAL A PAGAR</span><span style="font-family:'DM Mono',monospace">${fmt(order.totales?.total)}</span></div>
                    </div>
                </div>
            </div>

            ${order.observaciones ? `
                <div class="info-card" style="background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.2);">
                    <h4 style="color:var(--warning)">Observaciones</h4>
                    <p style="color:var(--text-secondary)">${order.observaciones}</p>
                </div>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn-success" onclick="printOrder('${orderId}')">
                <span class="material-icons">print</span> Imprimir
            </button>
            <button class="btn-warning" onclick="generatePDF('${orderId}')">
                <span class="material-icons">picture_as_pdf</span> PDF
            </button>
            ${isAdmin ? `
            <button class="btn-secondary" onclick="editOrder('${orderId}'); this.closest('.modal-overlay').remove();">
                <span class="material-icons">edit</span> Editar
            </button>
            <button class="btn-danger" onclick="deleteOrder('${orderId}').then(()=>{ const m=document.querySelector('.modal-overlay'); if(m) m.remove(); })">
                <span class="material-icons">delete</span> Eliminar
            </button>` : ''}
            <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                <span class="material-icons">close</span> Cerrar
            </button>
        </div>
    `;
    showModal(html);
};

function showModal(content) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal-content">${content}</div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

// ── USERS ──
function loadUsers() {
    if (currentUserRole !== 'admin') return;
    const usersRef = ref(db, 'usuarios');
    onValue(usersRef, (snapshot) => {
        const tbody = document.getElementById('users-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        const data = snapshot.val();
        if (!data) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No hay usuarios</td></tr>';
            return;
        }
        usersData = data;
        const arr = Object.entries(data).map(([id, u]) => ({id, ...u})).sort((a,b) => new Date(b.fechaRegistro||0) - new Date(a.fechaRegistro||0));
        const total = arr.length;
        const active = arr.filter(u => u.activo !== false).length;
        const admins = arr.filter(u => u.rol === 'admin').length;
        const setEl = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
        setEl('total-users', total); setEl('active-users', active); setEl('admin-users', admins);

        arr.forEach(user => {
            if (user.uid === currentUser?.uid) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:500;color:var(--text-primary)">${user.nombre||'N/A'}</td>
                <td style="color:var(--text-secondary)">${user.email}</td>
                <td style="color:var(--text-secondary)">${user.area||'N/A'}</td>
                <td>
                    <select class="role-select" onchange="changeUserRole('${user.uid}', this.value)" ${user.activo===false?'disabled':''}>
                        <option value="user"  ${user.rol==='user' ?'selected':''}>Usuario</option>
                        <option value="admin" ${user.rol==='admin'?'selected':''}>Administrador</option>
                    </select>
                </td>
                <td><span class="status-badge ${user.activo===false?'cancelada':'activa'}">${user.activo===false?'Inactivo':'Activo'}</span></td>
                <td style="color:var(--text-muted);font-size:0.82rem">${user.fechaRegistro?new Date(user.fechaRegistro).toLocaleDateString('es-CO'):'N/A'}</td>
                <td>
                    <button class="btn-icon ${user.activo===false?'btn-view':'btn-delete'}" onclick="toggleUserStatus('${user.uid}', ${!user.activo})" title="${user.activo===false?'Activar usuario':'Desactivar usuario'}">
                        <span class="material-icons">${user.activo===false?'check_circle':'block'}</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

window.changeUserRole = async function(userId, newRole) {
    if (currentUserRole !== 'admin') return;
    const ok = await showConfirm({ title: 'Cambiar Rol', message: `¿Cambiar rol a <strong>${newRole==='admin'?'Administrador':'Usuario'}</strong>?`, confirmText: 'Cambiar', type: 'warn' });
    if (!ok) { loadUsers(); return; }
    try {
        await update(ref(db, `usuarios/${userId}`), { rol: newRole, modificadoPor: currentUser.uid, fechaModificacion: new Date().toISOString() });
        showToast('success','Rol actualizado','El rol del usuario fue cambiado correctamente.');
    } catch (e) { showToast('error','Error', e.message); }
};

window.toggleUserStatus = async function(userId, activar) {
    if (currentUserRole !== 'admin') return;
    const ok = await showConfirm({ title: activar ? 'Activar Usuario' : 'Desactivar Usuario', message: `¿Estás seguro de ${activar?'activar':'desactivar'} este usuario?`, confirmText: activar?'Activar':'Desactivar', type: activar?'info':'danger' });
    if (!ok) return;
    try {
        await update(ref(db, `usuarios/${userId}`), { activo: activar, modificadoPor: currentUser.uid, fechaModificacion: new Date().toISOString() });
        showToast('success', activar?'Usuario activado':'Usuario desactivado','Estado actualizado correctamente.');
    } catch (e) { showToast('error','Error', e.message); }
};

// ── CHARTS ──
function initializeCharts() {
    const canvas = document.getElementById('orders-chart');
    if (!canvas) return;
    try {
        ordersChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Valor Total de Órdenes',
                    data: [],
                    borderColor: '#1A56E8',
                    backgroundColor: 'rgba(26,86,232,0.08)',
                    borderWidth: 2.5,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#1A56E8',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#162040',
                        borderColor: '#1E2E55',
                        borderWidth: 1,
                        titleColor: '#EEF2FF',
                        bodyColor: '#94A8D4',
                        padding: 12,
                        callbacks: {
                            label: ctx => ' $' + ctx.raw.toLocaleString('es-CO')
                        }
                    }
                },
                scales: {
                    x: { ticks: { color:'#5A70A0', font:{size:11} }, grid: { color:'rgba(30,46,85,0.5)' } },
                    y: {
                        beginAtZero: true,
                        ticks: { color:'#5A70A0', font:{size:11}, callback: v => '$' + (v/1000000 >= 1 ? (v/1000000).toFixed(1)+'M' : v.toLocaleString('es-CO')) },
                        grid: { color:'rgba(30,46,85,0.5)' }
                    }
                }
            }
        });
    } catch (e) { console.error('Chart init error:', e); }
}

function getLast6Months() {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ month: d.getMonth(), year: d.getFullYear(), label: d.toLocaleDateString('es-CO', { month:'short', year:'numeric' }) });
    }
    return months;
}

// ── PDF ──
window.generatePDF = async function(orderId) {
    const order = ordersData[orderId];
    if (!order) return;
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const fmt = v => '$' + (v||0).toLocaleString('es-CO');
        const comp = order.comprador || { razonSocial:'Vehidiesel SAS', nit:'890113554-3', direccion:'Barrio el bosque dg 21 45 112', telefono:'6056620828', correo:'Asistentecg@vehidiesel.com.co' };

        doc.setFillColor(26,86,232);
        doc.rect(0,0,210,28,'F');
        doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
        doc.text('VEHIDIESEL SAS', 15, 12);
        doc.setFontSize(9); doc.setFont(undefined,'normal');
        doc.text(`NIT: ${comp.nit}  |  Tel: ${comp.telefono}  |  ${comp.correo}`, 15, 19);
        doc.setFontSize(11); doc.setFont(undefined,'bold');
        doc.text(`ORDEN DE COMPRA #${order.numeroOrden}`, 195, 12, {align:'right'});
        doc.setFontSize(8); doc.setFont(undefined,'normal');
        const fecha = order.fecha ? new Date(order.fecha) : new Date();
        doc.text(`${fecha.toLocaleDateString('es-CO')} ${fecha.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}`, 195, 19, {align:'right'});

        doc.setTextColor(0,0,0);
        doc.setFontSize(9); doc.setFont(undefined,'bold');
        let y = 36;
        doc.setFillColor(240,244,255); doc.rect(14,y-5,86,28,'F');
        doc.setFillColor(240,244,255); doc.rect(110,y-5,86,28,'F');
        doc.setTextColor(26,86,232); doc.text('COMPRADOR', 18, y); doc.text('PROVEEDOR', 114, y);
        y += 5; doc.setFont(undefined,'normal'); doc.setTextColor(0,0,0);
        doc.text(comp.razonSocial.substring(0,30), 18, y); doc.text((order.proveedor?.razonSocial||'N/A').substring(0,30), 114, y); y+=5;
        doc.text(`NIT: ${comp.nit}`, 18, y); doc.text(`NIT: ${order.proveedor?.nit||'N/A'}`, 114, y); y+=5;
        doc.text(comp.direccion.substring(0,30), 18, y); doc.text((order.proveedor?.direccion||'').substring(0,30), 114, y); y+=5;
        doc.text(`Tel: ${comp.telefono}`, 18, y); if(order.proveedor?.telefono) doc.text(`Tel: ${order.proveedor.telefono}`, 114, y);

        y = 74;
        if(order.autorizadoPor) { doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(26,86,232); doc.text(`Autorizado por: `, 15, y); doc.setFont(undefined,'normal'); doc.setTextColor(0,0,0); doc.text(order.autorizadoPor, 52, y); y+=8; }

        doc.setFillColor(26,86,232); doc.rect(14,y,182,7,'F');
        doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont(undefined,'bold');
        doc.text('#',17,y+5); doc.text('Descripción',24,y+5); doc.text('Centro Costo',88,y+5);
        doc.text('Cant.',126,y+5); doc.text('P.Unit.',140,y+5); doc.text('Total',168,y+5);
        y += 10; doc.setFont(undefined,'normal'); doc.setTextColor(0,0,0); doc.setFontSize(8);

        (order.items||[]).forEach((item,i) => {
            if (y > 250) { doc.addPage(); y = 20; }
            if (i%2===0) { doc.setFillColor(247,249,255); doc.rect(14,y-4,182,7,'F'); }
            doc.text((i+1).toString(),17,y); doc.text((item.descripcion||'').substring(0,30),24,y);
            doc.text((item.centroCosto||'').substring(0,15),88,y); doc.text((item.cantidad||0).toString(),130,y);
            doc.text(fmt(item.pUnit),140,y); doc.text(fmt(item.total),165,y); y+=7;
        });

        y+=4; doc.setDrawColor(26,86,232); doc.line(120,y,196,y); y+=5;
        const totRows = [['Subtotal:', fmt(order.totales?.subtotal)], [`IVA (${order.totales?.ivaPercent||0}%):`, fmt(order.totales?.ivaValue)], ['Rete Fuente:', fmt(order.totales?.reteFuente)], ['Rete ICA:', fmt(order.totales?.reteIca)]];
        doc.setFontSize(8); doc.setTextColor(80,80,80);
        totRows.forEach(([l,v]) => { doc.text(l,125,y); doc.text(v,195,y,{align:'right'}); y+=5; });
        doc.setFillColor(26,86,232); doc.rect(120,y-2,76,8,'F');
        doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(9);
        doc.text('TOTAL:',125,y+4); doc.text(fmt(order.totales?.total),195,y+4,{align:'right'});

        if(order.observaciones) { y+=14; doc.setFont(undefined,'normal'); doc.setTextColor(0,0,0); doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.text('Observaciones:',15,y); doc.setFont(undefined,'normal'); y+=5; doc.text(order.observaciones.substring(0,100),15,y); }

        doc.save(`Orden_Compra_${order.numeroOrden}_Vehidiesel.pdf`);
        showToast('success','PDF generado',`Orden #${order.numeroOrden} descargada.`);
    } catch (e) {
        console.error(e);
        showToast('error','Error PDF','No se pudo generar el PDF.');
    }
};

// ── EXCEL ──
window.exportToExcel = function() {
    if (!ordersData || Object.keys(ordersData).length === 0) { showToast('warning','Sin datos','No hay órdenes para exportar.'); return; }
    const rows = [];
    Object.values(ordersData).forEach(order => {
        rows.push({
            'No. Orden': order.numeroOrden, 'Fecha': order.fecha?new Date(order.fecha).toLocaleDateString('es-CO'):'N/A',
            'Autorizado Por': order.autorizadoPor||'N/A', 'Proveedor': order.proveedor?.razonSocial||'N/A',
            'NIT': order.proveedor?.nit||'N/A', 'Tipo Gasto': order.tipoGasto||'N/A', 'Estado': order.estado||'ACTIVA',
            'Subtotal': order.totales?.subtotal||0, 'IVA %': order.totales?.ivaPercent||0,
            'Valor IVA': order.totales?.ivaValue||0, 'Rete Fuente': order.totales?.reteFuente||0,
            'Rete ICA': order.totales?.reteIca||0, 'Total': order.totales?.total||0,
            'Creado Por': order.creadoPor?.email||'N/A', 'Observaciones': order.observaciones||''
        });
        (order.items||[]).forEach(item => {
            rows.push({ 'No. Orden':'', 'Fecha':'', 'Autorizado Por':'', 'Proveedor': `  ↳ ${item.descripcion}`, 'NIT':'',
                'Tipo Gasto': item.centroCosto||'', 'Estado':'', 'Subtotal':'', 'IVA %':'', 'Valor IVA':'',
                'Rete Fuente':'', 'Rete ICA':'', 'Total': item.total,
                'Creado Por': `Cant: ${item.cantidad} × $${(item.pUnit||0).toLocaleString('es-CO')}`, 'Observaciones':'' });
        });
        rows.push({ 'No. Orden':'', 'Fecha':'', 'Autorizado Por':'', 'Proveedor': '─'.repeat(30), 'NIT':'', 'Tipo Gasto':'', 'Estado':'', 'Subtotal':'', 'IVA %':'', 'Valor IVA':'', 'Rete Fuente':'', 'Rete ICA':'', 'Total':'', 'Creado Por':'', 'Observaciones':'' });
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:10},{wch:12},{wch:22},{wch:32},{wch:15},{wch:14},{wch:10},{wch:14},{wch:7},{wch:14},{wch:14},{wch:14},{wch:14},{wch:28},{wch:32}];
    XLSX.utils.book_append_sheet(wb, ws, 'Órdenes de Compra');
    const d = new Date();
    XLSX.writeFile(wb, `Ordenes_Vehidiesel_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.xlsx`);
    showToast('success','Exportado','Archivo Excel descargado correctamente.');
};
