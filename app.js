import { auth, db } from './config.js';
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
    ref, 
    set, 
    push, 
    onValue, 
    runTransaction,
    get,
    remove,
    update
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// --- Variables Globales ---
let currentUser = null;
let currentUserRole = 'user';
let currentOrderNumber = 0;
let ordersData = {};
let currentEditOrderId = null;
let ordersChart = null;
let usersData = {};

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    addItemRow();
    setupEventListeners();
    initializeCharts();
});

function setupEventListeners() {
    const ivaInput = document.getElementById('iva-percent');
    const retefuenteInput = document.getElementById('retefuente');
    const reteicaInput = document.getElementById('reteica');
    const searchInput = document.getElementById('search-orders');
    const filterType = document.getElementById('filter-type');
    const filterDate = document.getElementById('filter-date');
    
    if (ivaInput) ivaInput.addEventListener('input', calculateTotals);
    if (retefuenteInput) retefuenteInput.addEventListener('input', calculateTotals);
    if (reteicaInput) reteicaInput.addEventListener('input', calculateTotals);
    if (searchInput) searchInput.addEventListener('input', filterOrders);
    if (filterType) filterType.addEventListener('change', filterOrders);
    if (filterDate) filterDate.addEventListener('change', filterOrders);
}

// --- Autenticación ---
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        signInWithEmailAndPassword(auth, email, password)
            .catch((error) => {
                let errorMessage = "Error: ";
                switch(error.code) {
                    case 'auth/user-not-found':
                        errorMessage += "Usuario no encontrado";
                        break;
                    case 'auth/wrong-password':
                        errorMessage += "Contraseña incorrecta";
                        break;
                    case 'auth/invalid-email':
                        errorMessage += "Email inválido";
                        break;
                    case 'auth/too-many-requests':
                        errorMessage += "Demasiados intentos. Intenta más tarde";
                        break;
                    default:
                        errorMessage += error.message;
                }
                document.getElementById('login-error').textContent = errorMessage;
            });
    });
}

window.logout = function() {
    signOut(auth);
}

// --- Verificar Rol del Usuario ---
async function checkUserRole(user) {
    try {
        const userRef = ref(db, `usuarios/${user.uid}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
            const userData = snapshot.val();
            currentUserRole = userData.rol || 'user';
            
            if (userData.activo === false) {
                console.warn("Usuario inactivo");
                await signOut(auth);
                alert("❌ Acceso denegado. Usuario inactivo.\n\nContacta al administrador.");
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('app-view').classList.add('hidden');
                return;
            }
            
            currentUser = { 
                uid: user.uid,
                email: user.email,
                ...userData 
            };
            
            const userNameEl = document.getElementById('user-name');
            const userRoleEl = document.getElementById('user-role');
            
            if (userNameEl) userNameEl.textContent = userData.nombre || user.email;
            if (userRoleEl) userRoleEl.textContent = currentUserRole === 'admin' ? 'Administrador' : 'Usuario';
            
        } else {
            console.warn("Usuario no autorizado");
            await signOut(auth);
            alert("❌ Acceso denegado. Este usuario no está registrado en el sistema.\n\nPor favor contacta al administrador.");
            document.getElementById('login-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
            return;
        }
        
        updateUIForRole();
        
        if (currentUserRole === 'admin') {
            loadUsers();
        }
        
    } catch (error) {
        console.error("Error verificando rol:", error);
        currentUserRole = 'user';
    }
}

function updateUIForRole() {
    const isAdmin = currentUserRole === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? 'inline-block' : 'none';
    });
}

// --- Función checkAuth MEJORADA (carga secuencial) ---
function checkAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await checkUserRole(user);
            
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('app-view').classList.remove('hidden');
            
            showLoadingIndicator();
            
            try {
                await getNextOrderNumber();
                await loadOrdersWithPromise();
                await loadDashboardDataWithPromise();
                
                hideLoadingIndicator();
                showSection('dashboard-section');
                
            } catch (error) {
                console.error("Error en carga inicial:", error);
                hideLoadingIndicator();
                alert("Error al cargar datos. Por favor recarga la página.");
            }
        } else {
            currentUser = null;
            currentUserRole = 'user';
            document.getElementById('login-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
        }
    });
}

// --- Función para cargar órdenes con Promise ---
function loadOrdersWithPromise() {
    return new Promise((resolve, reject) => {
        const ordersRef = ref(db, 'ordenes');
        const timeout = setTimeout(() => {
            reject(new Error("Timeout cargando órdenes"));
        }, 10000);
        
        get(ordersRef).then((snapshot) => {
            clearTimeout(timeout);
            
            const tbody = document.getElementById('orders-body');
            if (tbody) {
                const data = snapshot.val();
                
                if (!data) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">No hay órdenes registradas</td></tr>';
                    ordersData = {};
                } else {
                    ordersData = data;
                    filterOrders();
                }
                
                resolve(ordersData);
            } else {
                reject(new Error("No se encontró el elemento orders-body"));
            }
        }).catch(error => {
            clearTimeout(timeout);
            console.error("Error cargando órdenes:", error);
            reject(error);
        });
    });
}

// --- Función para cargar dashboard con Promise ---
function loadDashboardDataWithPromise() {
    return new Promise((resolve, reject) => {
        if (!ordersData || Object.keys(ordersData).length === 0) {
            updateDashboardWithEmptyData();
            resolve();
            return;
        }
        
        try {
            const ordersArray = Object.values(ordersData);
            
            const totalOrders = ordersArray.length;
            const totalAmount = ordersArray.reduce((sum, order) => sum + (order.totales?.total || 0), 0);
            const avgAmount = totalOrders > 0 ? totalAmount / totalOrders : 0;
            
            const ordersByType = {};
            ordersArray.forEach(order => {
                const type = order.tipoGasto || 'OTROS';
                ordersByType[type] = (ordersByType[type] || 0) + 1;
            });
            
            const last6Months = getLast6Months();
            const monthlyData = last6Months.map(month => {
                const monthOrders = ordersArray.filter(order => {
                    if (!order.fecha) return false;
                    const orderDate = new Date(order.fecha);
                    return orderDate.getMonth() === month.month && 
                           orderDate.getFullYear() === month.year;
                });
                return monthOrders.reduce((sum, order) => sum + (order.totales?.total || 0), 0);
            });
            
            updateDashboardUI({
                totalOrders,
                totalAmount,
                avgAmount,
                ordersByType,
                monthlyData,
                last6Months,
                ordersArray
            });
            
            resolve();
            
        } catch (error) {
            console.error("Error procesando dashboard:", error);
            reject(error);
        }
    });
}

// --- Actualizar UI del dashboard ---
function updateDashboardUI(data) {
    const {
        totalOrders,
        totalAmount,
        avgAmount,
        ordersByType,
        monthlyData,
        last6Months,
        ordersArray
    } = data;

    const elements = {
        totalOrders: document.getElementById('stat-total-orders'),
        totalAmount: document.getElementById('stat-total-amount'),
        avgAmount: document.getElementById('stat-avg-amount'),
        ordersByType: document.getElementById('orders-by-type'),
        recentOrders: document.getElementById('recent-orders')
    };

    if (elements.totalOrders) elements.totalOrders.textContent = totalOrders;
    if (elements.totalAmount) elements.totalAmount.textContent = '$' + totalAmount.toLocaleString('es-CO');
    if (elements.avgAmount) elements.avgAmount.textContent = '$' + avgAmount.toLocaleString('es-CO');
    
    if (elements.ordersByType) {
        if (Object.keys(ordersByType).length > 0) {
            elements.ordersByType.innerHTML = Object.entries(ordersByType)
                .map(([type, count]) => `
                    <div class="stat-item">
                        <span class="stat-label">${type}:</span>
                        <span class="stat-value">${count}</span>
                    </div>
                `).join('');
        } else {
            elements.ordersByType.innerHTML = '<div class="stat-item">No hay datos</div>';
        }
    }
    
    if (ordersChart) {
        ordersChart.data.labels = last6Months.map(m => m.label);
        ordersChart.data.datasets[0].data = monthlyData;
        ordersChart.update();
    }
    
    if (elements.recentOrders) {
        const recentOrders = ordersArray
            .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
            .slice(0, 5);
        
        if (recentOrders.length > 0) {
            elements.recentOrders.innerHTML = recentOrders.map(order => `
                <div class="recent-order-item">
                    <div>
                        <strong>#${order.numeroOrden}</strong> - ${order.proveedor?.razonSocial || 'N/A'}
                        <br>
                        <small>${order.fecha ? new Date(order.fecha).toLocaleDateString('es-CO') : 'N/A'}</small>
                    </div>
                    <div class="recent-order-amount">
                        $${(order.totales?.total || 0).toLocaleString('es-CO')}
                    </div>
                </div>
            `).join('');
        } else {
            elements.recentOrders.innerHTML = '<div class="recent-order-item">No hay órdenes recientes</div>';
        }
    }
}

// --- Navegación MEJORADA ---
window.showSection = function(sectionId) {
    document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.remove('hidden');
    
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    const buttons = document.querySelectorAll('.nav-btn');
    for (let btn of buttons) {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(sectionId)) {
            btn.classList.add('active');
            break;
        }
    }
    
    if (sectionId === 'list-section') {
        loadOrders();
    } else if (sectionId === 'dashboard-section') {
        if (ordersData && Object.keys(ordersData).length > 0) {
            loadDashboardDataWithPromise().catch(console.error);
        } else {
            showLoadingIndicator();
            loadOrdersWithPromise().then(() => {
                return loadDashboardDataWithPromise();
            }).then(() => {
                hideLoadingIndicator();
            }).catch(console.error);
        }
    } else if (sectionId === 'admin-users-section' && currentUserRole === 'admin') {
        loadUsers();
    }
};

// --- Refrescar dashboard manualmente ---
window.refreshDashboard = function() {
    showLoadingIndicator();
    loadOrdersWithPromise()
        .then(() => loadDashboardDataWithPromise())
        .then(() => {
            hideLoadingIndicator();
            showSection('dashboard-section');
        })
        .catch(error => {
            console.error("Error refrescando dashboard:", error);
            hideLoadingIndicator();
            alert("Error al refrescar el dashboard");
        });
};

// --- Indicadores de carga ---
function showLoadingIndicator() {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.innerHTML = '<div class="spinner"></div><p>Cargando datos...</p>';
        document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
}

function hideLoadingIndicator() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
}

// --- Obtener número de orden con TRANSACCIÓN (anti-duplicados) ---
async function getNextOrderNumber() {
    const counterRef = ref(db, 'metadata/lastOrderNumber');
    
    try {
        const result = await runTransaction(counterRef, (currentVal) => {
            return (currentVal || 999) + 1;
        });
        
        currentOrderNumber = result.snapshot.val();
        const displayEl = document.getElementById('next-order-display');
        if (displayEl) displayEl.textContent = currentOrderNumber;
        
        return currentOrderNumber;
        
    } catch (error) {
        console.error("Error en transacción de número de orden", error);
        try {
            const snapshot = await get(counterRef);
            let lastNum = snapshot.exists() ? snapshot.val() : 999;
            currentOrderNumber = lastNum + 1;
            await set(counterRef, currentOrderNumber);
            const displayEl = document.getElementById('next-order-display');
            if (displayEl) displayEl.textContent = currentOrderNumber;
        } catch (fallbackError) {
            console.error("Error en fallback", fallbackError);
            const displayEl = document.getElementById('next-order-display');
            if (displayEl) displayEl.textContent = "Error";
        }
    }
}

// --- Manejo de Items ---
window.addItemRow = function(itemData = null) {
    const tbody = document.getElementById('items-body');
    if (!tbody) return;
    
    const rowId = Date.now() + Math.floor(Math.random() * 1000);
    const rowCount = tbody.children.length + 1;
    
    const tr = document.createElement('tr');
    tr.id = `row-${rowId}`;
    
    if (itemData) {
        tr.innerHTML = `
            <td>${rowCount}</td>
            <td><input type="text" class="item-desc" value="${itemData.descripcion || ''}" placeholder="Descripción" required></td>
            <td><input type="number" class="item-qty" value="${itemData.cantidad || 1}" min="1" onchange="calculateRow('${rowId}')"></td>
            <td><input type="number" class="item-price" value="${itemData.pUnit || 0}" min="0" step="100" onchange="calculateRow('${rowId}')"></td>
            <td><span class="item-total">$${(itemData.total || 0).toLocaleString('es-CO')}</span></td>
            <td><button type="button" class="btn-remove" onclick="removeRow('${rowId}')"><span class="material-icons">delete</span></button></td>
        `;
        tr.dataset.total = itemData.total || 0;
    } else {
        tr.innerHTML = `
            <td>${rowCount}</td>
            <td><input type="text" class="item-desc" placeholder="Descripción" required></td>
            <td><input type="number" class="item-qty" value="1" min="1" onchange="calculateRow('${rowId}')"></td>
            <td><input type="number" class="item-price" value="0" min="0" step="100" onchange="calculateRow('${rowId}')"></td>
            <td><span class="item-total">$0</span></td>
            <td><button type="button" class="btn-remove" onclick="removeRow('${rowId}')"><span class="material-icons">delete</span></button></td>
        `;
        tr.dataset.total = 0;
    }
    
    tbody.appendChild(tr);
    if (!itemData) calculateRow(rowId);
};

window.removeRow = function(id) {
    const rows = document.querySelectorAll('#items-body tr');
    if (rows.length <= 1) {
        alert("Debe haber al menos un ítem en la orden");
        return;
    }
    
    const row = document.getElementById(`row-${id}`);
    if(row) {
        row.remove();
        renumberRows();
        calculateTotals();
    }
};

function renumberRows() {
    const rows = document.querySelectorAll('#items-body tr');
    rows.forEach((row, index) => {
        const cell = row.cells[0];
        if (cell) cell.textContent = index + 1;
    });
}

window.calculateRow = function(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;
    
    const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    const total = qty * price;
    
    const totalSpan = row.querySelector('.item-total');
    if (totalSpan) {
        totalSpan.textContent = total.toLocaleString('es-CO', {
            style: 'currency', 
            currency: 'COP',
            minimumFractionDigits: 0
        });
    }
    
    row.dataset.total = total;
    calculateTotals();
};

window.calculateTotals = function() {
    let subtotal = 0;
    document.querySelectorAll('#items-body tr').forEach(row => {
        subtotal += parseFloat(row.dataset.total) || 0;
    });

    const ivaPercent = parseFloat(document.getElementById('iva-percent')?.value) || 0;
    const reteFuente = parseFloat(document.getElementById('retefuente')?.value) || 0;
    const reteIca = parseFloat(document.getElementById('reteica')?.value) || 0;

    const ivaValue = subtotal * (ivaPercent / 100);
    const total = subtotal + ivaValue - reteFuente - reteIca;

    const subtotalEl = document.getElementById('disp-subtotal');
    const ivaEl = document.getElementById('disp-iva');
    const totalEl = document.getElementById('disp-total');
    
    if (subtotalEl) {
        subtotalEl.textContent = subtotal.toLocaleString('es-CO', {
            style: 'currency', 
            currency: 'COP',
            minimumFractionDigits: 0
        });
    }
    
    if (ivaEl) {
        ivaEl.textContent = ivaValue.toLocaleString('es-CO', {
            style: 'currency', 
            currency: 'COP',
            minimumFractionDigits: 0
        });
    }
    
    if (totalEl) {
        totalEl.textContent = total.toLocaleString('es-CO', {
            style: 'currency', 
            currency: 'COP',
            minimumFractionDigits: 0
        });
    }

    return { subtotal, ivaPercent, ivaValue, reteFuente, reteIca, total };
};

function validateItems() {
    const rows = document.querySelectorAll('#items-body tr');
    if (rows.length === 0) {
        alert("Debe agregar al menos un ítem");
        return false;
    }
    
    for (let row of rows) {
        const desc = row.querySelector('.item-desc')?.value.trim();
        const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        
        if (!desc) {
            alert("Todos los ítems deben tener una descripción");
            return false;
        }
        
        if (qty <= 0) {
            alert("La cantidad debe ser mayor a cero");
            return false;
        }
        
        if (price <= 0) {
            alert("El precio unitario debe ser mayor a cero");
            return false;
        }
    }
    
    return true;
}

// --- Guardar Orden (MEJORADO con transacciones) ---
const orderForm = document.getElementById('order-form');
if (orderForm) {
    orderForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if(!currentUser) {
            alert("Debes estar logueado");
            return;
        }
        
        if (!validateItems()) return;

        const totals = calculateTotals();
        
        const itemsData = [];
        document.querySelectorAll('#items-body tr').forEach((row, index) => {
            itemsData.push({
                numero: index + 1,
                descripcion: row.querySelector('.item-desc').value,
                cantidad: parseFloat(row.querySelector('.item-qty').value),
                pUnit: parseFloat(row.querySelector('.item-price').value),
                total: parseFloat(row.dataset.total)
            });
        });

        const tipoGastoElement = document.querySelector('input[name="tipoGasto"]:checked');
        const tipoGasto = tipoGastoElement ? tipoGastoElement.value : 'COMPRA';

        const orderNumber = currentOrderNumber;

        const orderData = {
            numeroOrden: orderNumber,
            fecha: new Date().toISOString(),
            comprador: {
                razonSocial: "Vehidiesel sas",
                nit: "890113554-3",
                direccion: "Barrio el bosque dg 21 45 112",
                telefono: "6056620828",
                correo: "Asistentecg@vehidiesel.com.co"
            },
            proveedor: {
                razonSocial: document.getElementById('prov-razon')?.value || '',
                nit: document.getElementById('prov-nit')?.value || '',
                direccion: document.getElementById('prov-dir')?.value || '',
                telefono: document.getElementById('prov-tel')?.value || '',
                correo: document.getElementById('prov-email')?.value || ''
            },
            tipoGasto: tipoGasto,
            items: itemsData,
            observaciones: document.getElementById('obs')?.value || '',
            totales: totals,
            estado: 'ACTIVA',
            creadoPor: {
                uid: currentUser.uid,
                email: currentUser.email,
                nombre: currentUser.nombre || currentUser.email
            },
            ultimaModificacion: new Date().toISOString()
        };

        try {
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Guardando...';
            submitBtn.disabled = true;

            if (currentEditOrderId) {
                const orderRef = ref(db, `ordenes/${currentEditOrderId}`);
                await update(orderRef, orderData);
                alert("¡Orden actualizada exitosamente!");
                currentEditOrderId = null;
            } else {
                const newOrderRef = push(ref(db, 'ordenes'));
                await set(newOrderRef, orderData);

                const counterRef = ref(db, 'metadata/lastOrderNumber');
                await runTransaction(counterRef, (currentVal) => {
                    const minVal = Math.max(currentVal || 999, orderNumber);
                    return minVal;
                });
                
                alert("¡Orden guardada exitosamente!");
            }
            
            resetOrderForm();
            await getNextOrderNumber();
            await loadOrdersWithPromise();
            await loadDashboardDataWithPromise();
            
            showSection('list-section');
            
        } catch (error) {
            console.error(error);
            alert("Error al guardar: " + error.message);
        } finally {
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.innerHTML = '<span class="material-icons">save</span> Guardar Orden';
            submitBtn.disabled = false;
        }
    });
}

// --- Editar Orden (Solo Admin) ---
window.editOrder = function(orderId) {
    if (currentUserRole !== 'admin') {
        alert("No tienes permisos para editar órdenes");
        return;
    }
    
    const order = ordersData[orderId];
    if (!order) return;
    
    currentEditOrderId = orderId;
    currentOrderNumber = order.numeroOrden;
    
    document.getElementById('prov-razon').value = order.proveedor?.razonSocial || '';
    document.getElementById('prov-nit').value = order.proveedor?.nit || '';
    document.getElementById('prov-dir').value = order.proveedor?.direccion || '';
    document.getElementById('prov-tel').value = order.proveedor?.telefono || '';
    document.getElementById('prov-email').value = order.proveedor?.correo || '';
    
    const tipoGastoRadios = document.querySelectorAll('input[name="tipoGasto"]');
    tipoGastoRadios.forEach(radio => {
        if (radio.value === order.tipoGasto) radio.checked = true;
    });
    
    document.getElementById('items-body').innerHTML = '';
    if (order.items && order.items.length > 0) {
        order.items.forEach(item => addItemRow(item));
    } else {
        addItemRow();
    }
    
    document.getElementById('iva-percent').value = order.totales?.ivaPercent || 19;
    document.getElementById('retefuente').value = order.totales?.reteFuente || 0;
    document.getElementById('reteica').value = order.totales?.reteIca || 0;
    document.getElementById('obs').value = order.observaciones || '';
    document.getElementById('next-order-display').textContent = order.numeroOrden;
    
    calculateTotals();
    showSection('create-section');
    
    const submitBtn = document.querySelector('#order-form button[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = '<span class="material-icons">update</span> Actualizar Orden';
};

// --- Eliminar Orden (Solo Admin) ---
window.deleteOrder = async function(orderId) {
    if (currentUserRole !== 'admin') {
        alert("No tienes permisos para eliminar órdenes");
        return;
    }
    
    if (!confirm("¿Está seguro de eliminar esta orden?")) return;
    
    try {
        const orderRef = ref(db, `ordenes/${orderId}`);
        await remove(orderRef);
        alert("Orden eliminada exitosamente");
        await loadOrdersWithPromise();
        await loadDashboardDataWithPromise();
    } catch (error) {
        console.error(error);
        alert("Error al eliminar: " + error.message);
    }
};

// --- Resetear Formulario ---
window.resetOrderForm = function() {
    document.getElementById('order-form')?.reset();
    document.getElementById('items-body').innerHTML = '';
    addItemRow();
    document.getElementById('iva-percent').value = '19';
    document.getElementById('retefuente').value = '0';
    document.getElementById('reteica').value = '0';
    calculateTotals();
    currentEditOrderId = null;
    
    const submitBtn = document.querySelector('#order-form button[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = '<span class="material-icons">save</span> Guardar Orden';
    
    getNextOrderNumber();
};

// --- Cargar Órdenes (con onValue para tiempo real) ---
function loadOrders() {
    const ordersRef = ref(db, 'ordenes');
    onValue(ordersRef, (snapshot) => {
        const tbody = document.getElementById('orders-body');
        if (!tbody) return;
        
        const data = snapshot.val();
        
        if (!data) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">No hay órdenes registradas</td></tr>';
            ordersData = {};
        } else {
            ordersData = data;
            filterOrders();
        }
        
        if (!document.getElementById('dashboard-section').classList.contains('hidden')) {
            loadDashboardDataWithPromise().catch(console.error);
        }
    });
}

// --- Filtrar Órdenes ---
function filterOrders() {
    const searchTerm = document.getElementById('search-orders')?.value.toLowerCase() || '';
    const filterType = document.getElementById('filter-type')?.value || '';
    const filterDate = document.getElementById('filter-date')?.value || '';
    
    const ordersArray = Object.entries(ordersData).map(([id, order]) => ({
        id,
        ...order
    })).filter(order => {
        const matchesSearch = searchTerm === '' || 
            order.proveedor?.razonSocial?.toLowerCase().includes(searchTerm) ||
            order.numeroOrden?.toString().includes(searchTerm) ||
            order.tipoGasto?.toLowerCase().includes(searchTerm);
        
        const matchesType = filterType === '' || order.tipoGasto === filterType;
        
        let matchesDate = true;
        if (filterDate && order.fecha) {
            const orderDate = new Date(order.fecha).toISOString().split('T')[0];
            matchesDate = orderDate === filterDate;
        }
        
        return matchesSearch && matchesType && matchesDate;
    }).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    displayOrders(ordersArray);
}

// --- Mostrar Órdenes en Tabla ---
function displayOrders(orders) {
    const tbody = document.getElementById('orders-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">No se encontraron órdenes</td></tr>';
        return;
    }
    
    const isAdmin = currentUserRole === 'admin';
    
    orders.forEach(order => {
        const tr = document.createElement('tr');
        const dateObj = new Date(order.fecha);
        const dateStr = order.fecha ? dateObj.toLocaleDateString('es-CO') + ' ' + dateObj.toLocaleTimeString('es-CO') : 'N/A';
        
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><span class="status-badge ${order.estado?.toLowerCase() || 'activa'}">#${order.numeroOrden}</span></td>
            <td>${order.proveedor?.razonSocial || 'N/A'}</td>
            <td>${order.tipoGasto || 'N/A'}</td>
            <td>$${(order.totales?.total || 0).toLocaleString('es-CO')}</td>
            <td>${order.creadoPor?.email || 'N/A'}</td>
            <td>
                <button class="btn-icon" onclick="viewOrderDetails('${order.id}')" title="Ver detalles">
                    <span class="material-icons">visibility</span>
                </button>
                ${isAdmin ? `
                <button class="btn-icon" onclick="editOrder('${order.id}')" title="Editar">
                    <span class="material-icons">edit</span>
                </button>
                <button class="btn-icon btn-delete" onclick="deleteOrder('${order.id}')" title="Eliminar">
                    <span class="material-icons">delete</span>
                </button>
                ` : ''}
                <button class="btn-icon" onclick="generatePDF('${order.id}')" title="Generar PDF">
                    <span class="material-icons">picture_as_pdf</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Administración de Usuarios (Solo Admin) ---
function loadUsers() {
    if (currentUserRole !== 'admin') return;
    
    const usersRef = ref(db, 'usuarios');
    onValue(usersRef, (snapshot) => {
        const tbody = document.getElementById('users-body');
        const totalUsersSpan = document.getElementById('total-users');
        const activeUsersSpan = document.getElementById('active-users');
        const adminUsersSpan = document.getElementById('admin-users');
        
        if (!tbody) return;
        
        tbody.innerHTML = '';
        const data = snapshot.val();
        
        if (!data) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">No hay usuarios registrados</td></tr>';
            return;
        }

        usersData = data;
        
        const usersArray = Object.entries(data).map(([id, user]) => ({
            id,
            ...user
        })).sort((a, b) => new Date(b.fechaRegistro || 0) - new Date(a.fechaRegistro || 0));

        const totalUsers = usersArray.length;
        const activeUsers = usersArray.filter(u => u.activo !== false).length;
        const adminUsers = usersArray.filter(u => u.rol === 'admin').length;
        
        if (totalUsersSpan) totalUsersSpan.textContent = totalUsers;
        if (activeUsersSpan) activeUsersSpan.textContent = activeUsers;
        if (adminUsersSpan) adminUsersSpan.textContent = adminUsers;

        usersArray.forEach(user => {
            if (user.uid === currentUser?.uid) return;
            
            const tr = document.createElement('tr');
            const fechaReg = user.fechaRegistro ? new Date(user.fechaRegistro).toLocaleDateString('es-CO') : 'N/A';
            
            tr.innerHTML = `
                <td>${user.nombre || 'N/A'}</td>
                <td>${user.email}</td>
                <td>${user.area || 'N/A'}</td>
                <td>
                    <select class="role-select" onchange="changeUserRole('${user.uid}', this.value)" ${user.activo === false ? 'disabled' : ''}>
                        <option value="user" ${user.rol === 'user' ? 'selected' : ''}>Usuario</option>
                        <option value="admin" ${user.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                    </select>
                </td>
                <td>
                    <span class="status-badge ${user.activo === false ? 'inactivo' : 'activo'}">
                        ${user.activo === false ? 'Inactivo' : 'Activo'}
                    </span>
                </td>
                <td>${fechaReg}</td>
                <td>
                    <button class="btn-icon" onclick="toggleUserStatus('${user.uid}', ${!user.activo})" title="${user.activo === false ? 'Activar' : 'Desactivar'}">
                        <span class="material-icons">${user.activo === false ? 'check_circle' : 'block'}</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// --- Cambiar rol de usuario (solo admin) ---
window.changeUserRole = async function(userId, newRole) {
    if (currentUserRole !== 'admin') {
        alert("No tienes permisos para realizar esta acción");
        return;
    }
    
    if (!confirm(`¿Cambiar rol a ${newRole === 'admin' ? 'Administrador' : 'Usuario'}?`)) return;
    
    try {
        const userRef = ref(db, `usuarios/${userId}`);
        await update(userRef, {
            rol: newRole,
            modificadoPor: currentUser.uid,
            fechaModificacion: new Date().toISOString()
        });
        alert("Rol actualizado exitosamente");
    } catch (error) {
        console.error(error);
        alert("Error al cambiar rol: " + error.message);
    }
};

// --- Activar/Desactivar usuario (solo admin) ---
window.toggleUserStatus = async function(userId, activar) {
    if (currentUserRole !== 'admin') {
        alert("No tienes permisos para realizar esta acción");
        return;
    }
    
    if (!confirm(`¿${activar ? 'Activar' : 'Desactivar'} este usuario?`)) return;
    
    try {
        const userRef = ref(db, `usuarios/${userId}`);
        await update(userRef, {
            activo: activar,
            modificadoPor: currentUser.uid,
            fechaModificacion: new Date().toISOString()
        });
        alert(`Usuario ${activar ? 'activado' : 'desactivado'} exitosamente`);
    } catch (error) {
        console.error(error);
        alert("Error al cambiar estado: " + error.message);
    }
};

// --- Dashboard y Estadísticas ---
function initializeCharts() {
    const canvas = document.getElementById('orders-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    try {
        ordersChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Valor de Órdenes',
                    data: [],
                    borderColor: '#0D47A1',
                    backgroundColor: 'rgba(13, 71, 161, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString('es-CO');
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error initializing chart:", error);
    }
}

function getLast6Months() {
    const months = [];
    const date = new Date();
    
    for (let i = 5; i >= 0; i--) {
        const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
        months.push({
            month: d.getMonth(),
            year: d.getFullYear(),
            label: d.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })
        });
    }
    
    return months;
}

function updateDashboardWithEmptyData() {
    const elements = {
        totalOrders: document.getElementById('stat-total-orders'),
        totalAmount: document.getElementById('stat-total-amount'),
        avgAmount: document.getElementById('stat-avg-amount'),
        ordersByType: document.getElementById('orders-by-type'),
        recentOrders: document.getElementById('recent-orders')
    };
    
    if (elements.totalOrders) elements.totalOrders.textContent = '0';
    if (elements.totalAmount) elements.totalAmount.textContent = '$0';
    if (elements.avgAmount) elements.avgAmount.textContent = '$0';
    if (elements.ordersByType) elements.ordersByType.innerHTML = '<div class="stat-item">No hay datos</div>';
    if (elements.recentOrders) elements.recentOrders.innerHTML = '<div class="recent-order-item">No hay órdenes recientes</div>';
    
    if (ordersChart) {
        ordersChart.data.labels = [];
        ordersChart.data.datasets[0].data = [];
        ordersChart.update();
    }
}

// --- Ver Detalles de Orden ---
window.viewOrderDetails = function(orderId) {
    const order = ordersData[orderId];
    if (!order) return;
    
    const isAdmin = currentUserRole === 'admin';
    
    const detailsHtml = `
        <div style="padding:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h3 style="color:#0D47A1;">Orden de Compra #${order.numeroOrden}</h3>
                <span class="status-badge ${order.estado?.toLowerCase() || 'activa'}">${order.estado || 'ACTIVA'}</span>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
                <div class="info-card">
                    <h4>Comprador</h4>
                    <p><strong>${order.comprador?.razonSocial || 'Vehidiesel sas'}</strong></p>
                    <p>NIT: ${order.comprador?.nit || '890113554-3'}</p>
                    <p>${order.comprador?.direccion || 'Barrio el bosque dg 21 45 112'}</p>
                    <p>Tel: ${order.comprador?.telefono || '6056620828'}</p>
                    <p>Email: ${order.comprador?.correo || 'Asistentecg@vehidiesel.com.co'}</p>
                </div>
                
                <div class="info-card">
                    <h4>Proveedor</h4>
                    <p><strong>${order.proveedor?.razonSocial || 'N/A'}</strong></p>
                    <p>NIT: ${order.proveedor?.nit || 'N/A'}</p>
                    <p>${order.proveedor?.direccion || 'N/A'}</p>
                    <p>Tel: ${order.proveedor?.telefono || 'N/A'}</p>
                    <p>Email: ${order.proveedor?.correo || 'N/A'}</p>
                </div>
            </div>
            
            <div class="info-card" style="margin-bottom:20px;">
                <h4>Tipo de Gasto</h4>
                <p>${order.tipoGasto || 'N/A'}</p>
            </div>
            
            <div class="info-card" style="margin-bottom:20px;">
                <h4>Detalle de Ítems</h4>
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#0D47A1; color:white;">
                            <th style="padding:8px;">#</th>
                            <th style="padding:8px;">Descripción</th>
                            <th style="padding:8px;">Cantidad</th>
                            <th style="padding:8px;">P. Unitario</th>
                            <th style="padding:8px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${order.items && order.items.length > 0 ? order.items.map(item => `
                            <tr style="border-bottom:1px solid #ddd;">
                                <td style="padding:8px;">${item.numero || ''}</td>
                                <td style="padding:8px;">${item.descripcion || ''}</td>
                                <td style="padding:8px;">${item.cantidad || 0}</td>
                                <td style="padding:8px;">$${(item.pUnit || 0).toLocaleString('es-CO')}</td>
                                <td style="padding:8px;">$${(item.total || 0).toLocaleString('es-CO')}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="5" style="padding:8px; text-align:center;">No hay items</td></tr>'}
                    </tbody>
                </table>
            </div>
            
            <div class="info-card" style="margin-bottom:20px;">
                <h4>Resumen Financiero</h4>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Subtotal:</span> <span>$${(order.totales?.subtotal || 0).toLocaleString('es-CO')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>IVA (${order.totales?.ivaPercent || 0}%):</span> <span>$${(order.totales?.ivaValue || 0).toLocaleString('es-CO')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Rete Fuente:</span> <span>$${(order.totales?.reteFuente || 0).toLocaleString('es-CO')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Rete ICA:</span> <span>$${(order.totales?.reteIca || 0).toLocaleString('es-CO')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; border-top:2px solid #0D47A1; padding-top:10px; margin-top:10px;">
                    <span>TOTAL:</span> <span>$${(order.totales?.total || 0).toLocaleString('es-CO')}</span>
                </div>
            </div>
            
            ${order.observaciones ? `
                <div class="info-card" style="background:#fff3e0;">
                    <h4>Observaciones</h4>
                    <p>${order.observaciones}</p>
                </div>
            ` : ''}
            
            <div style="margin-top:20px; text-align:right; color:#666; font-size:0.9rem;">
                <p>Creado por: ${order.creadoPor?.email || 'N/A'}</p>
                <p>Fecha: ${order.fecha ? new Date(order.fecha).toLocaleString('es-CO') : 'N/A'}</p>
                ${order.ultimaModificacion ? `<p>Última modificación: ${new Date(order.ultimaModificacion).toLocaleString('es-CO')}</p>` : ''}
            </div>
            
            <div style="display:flex; gap:10px; margin-top:20px; justify-content:flex-end;">
                <button class="btn-primary" onclick="generatePDF('${orderId}'); this.closest('.modal-overlay').remove();">
                    <span class="material-icons">picture_as_pdf</span> Generar PDF
                </button>
                ${isAdmin ? `
                <button class="btn-secondary" onclick="editOrder('${orderId}'); this.closest('.modal-overlay').remove();">
                    <span class="material-icons">edit</span> Editar
                </button>
                <button class="btn-delete" onclick="if(confirm('¿Eliminar orden?')) { deleteOrder('${orderId}'); this.closest('.modal-overlay').remove(); }">
                    <span class="material-icons">delete</span> Eliminar
                </button>
                ` : ''}
            </div>
        </div>
    `;
    
    showModal(detailsHtml);
};

function showModal(content) {
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
}

// --- Generar PDF ---
window.generatePDF = async function(orderId) {
    const order = ordersData[orderId];
    if (!order) return;
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(20);
        doc.setTextColor(13, 71, 161);
        doc.text('VEHIDIESEL SAS', 105, 20, { align: 'center' });
        
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text(`ORDEN DE COMPRA #${order.numeroOrden}`, 105, 30, { align: 'center' });
        
        doc.setDrawColor(13, 71, 161);
        doc.line(20, 35, 190, 35);
        
        doc.setFontSize(10);
        doc.text(`Fecha: ${order.fecha ? new Date(order.fecha).toLocaleDateString('es-CO') : 'N/A'}`, 20, 45);
        doc.text(`Hora: ${order.fecha ? new Date(order.fecha).toLocaleTimeString('es-CO') : 'N/A'}`, 20, 50);
        
        doc.setFontSize(12);
        doc.setTextColor(13, 71, 161);
        doc.text('DATOS DEL PROVEEDOR', 20, 60);
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Razón Social: ${order.proveedor?.razonSocial || 'N/A'}`, 20, 68);
        doc.text(`NIT: ${order.proveedor?.nit || 'N/A'}`, 20, 75);
        if (order.proveedor?.direccion) doc.text(`Dirección: ${order.proveedor.direccion}`, 20, 82);
        if (order.proveedor?.telefono) doc.text(`Teléfono: ${order.proveedor.telefono}`, 20, 89);
        if (order.proveedor?.correo) doc.text(`Email: ${order.proveedor.correo}`, 20, 96);
        
        doc.text(`Tipo de Gasto: ${order.tipoGasto || 'N/A'}`, 20, 105);
        
        doc.setFontSize(12);
        doc.setTextColor(13, 71, 161);
        doc.text('DETALLE DE ÍTEMS', 20, 115);
        
        let y = 125;
        doc.setFillColor(240, 240, 240);
        doc.rect(20, y - 5, 170, 7, 'F');
        
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text('#', 22, y);
        doc.text('Descripción', 40, y);
        doc.text('Cant.', 100, y);
        doc.text('P. Unit', 125, y);
        doc.text('Total', 155, y);
        
        y += 5;
        doc.line(20, y, 190, y);
        y += 5;
        
        if (order.items && order.items.length > 0) {
            order.items.forEach((item, index) => {
                if (y > 250) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.text((item.numero || index + 1).toString(), 22, y);
                doc.text((item.descripcion || '').substring(0, 30), 40, y);
                doc.text((item.cantidad || 0).toString(), 105, y);
                doc.text('$' + (item.pUnit || 0).toLocaleString('es-CO'), 125, y);
                doc.text('$' + (item.total || 0).toLocaleString('es-CO'), 155, y);
                
                y += 7;
            });
        }
        
        y += 5;
        doc.line(120, y, 190, y);
        y += 5;
        
        doc.text('Subtotal:', 125, y);
        doc.text('$' + (order.totales?.subtotal || 0).toLocaleString('es-CO'), 155, y);
        y += 5;
        
        doc.text(`IVA (${order.totales?.ivaPercent || 0}%):`, 125, y);
        doc.text('$' + (order.totales?.ivaValue || 0).toLocaleString('es-CO'), 155, y);
        y += 5;
        
        doc.text('Rete Fuente:', 125, y);
        doc.text('$' + (order.totales?.reteFuente || 0).toLocaleString('es-CO'), 155, y);
        y += 5;
        
        doc.text('Rete ICA:', 125, y);
        doc.text('$' + (order.totales?.reteIca || 0).toLocaleString('es-CO'), 155, y);
        y += 5;
        
        doc.setDrawColor(13, 71, 161);
        doc.line(120, y, 190, y);
        y += 5;
        
        doc.setFontSize(11);
        doc.setTextColor(13, 71, 161);
        doc.text('TOTAL:', 125, y);
        doc.text('$' + (order.totales?.total || 0).toLocaleString('es-CO'), 155, y);
        
        if (order.observaciones) {
            y += 15;
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text('Observaciones:', 20, y);
            y += 5;
            doc.text(order.observaciones, 20, y);
        }
        
        doc.save(`Orden_Compra_${order.numeroOrden}.pdf`);
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error al generar PDF. Asegúrate de tener la librería jsPDF cargada.');
    }
};

// --- Exportar a Excel ---
window.exportToExcel = function() {
    if (!ordersData || Object.keys(ordersData).length === 0) {
        alert("No hay datos para exportar");
        return;
    }
    
    const exportData = [];
    
    Object.entries(ordersData).forEach(([id, order]) => {
        exportData.push({
            'No. Orden': order.numeroOrden,
            'Fecha': order.fecha ? new Date(order.fecha).toLocaleDateString('es-CO') : 'N/A',
            'Hora': order.fecha ? new Date(order.fecha).toLocaleTimeString('es-CO') : 'N/A',
            'Proveedor': order.proveedor?.razonSocial || 'N/A',
            'NIT': order.proveedor?.nit || 'N/A',
            'Tipo Gasto': order.tipoGasto || 'N/A',
            'Estado': order.estado || 'ACTIVA',
            'Subtotal': order.totales?.subtotal || 0,
            'IVA %': order.totales?.ivaPercent || 0,
            'Valor IVA': order.totales?.ivaValue || 0,
            'Rete Fuente': order.totales?.reteFuente || 0,
            'Rete ICA': order.totales?.reteIca || 0,
            'Total': order.totales?.total || 0,
            'Creado Por': order.creadoPor?.email || 'N/A',
            'Observaciones': order.observaciones || ''
        });
    });
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    const colWidths = [
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 15 },
        { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 8 }, { wch: 15 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 30 }
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, "Órdenes de Compra");
    
    const date = new Date();
    const fileName = `Ordenes_Compra_Vehidiesel_${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}.xlsx`;
    
    XLSX.writeFile(wb, fileName);
};