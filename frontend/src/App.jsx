import React, { useState, useEffect, useRef } from 'react';

// --- CAMBIO: Definimos la URL de nuestra API de Cloudflare ---
const API_URL = 'https://agentemain.renalenis.workers.dev';

// --- UTILIDADES (Sin cambios) ---

// Validar RUT chileno
const validarRUT = (rut) => {
    if (!rut || rut.length < 3) return false;
    const rutLimpio = rut.replace(/\./g, '').replace(/-/g, '');
    const cuerpo = rutLimpio.slice(0, -1);
    const dv = rutLimpio.slice(-1).toUpperCase();
    if (!/^\d+$/.test(cuerpo)) return false;
    let suma = 0;
    let multiplo = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += parseInt(cuerpo.charAt(i)) * multiplo;
        multiplo = multiplo === 7 ? 2 : multiplo + 1;
    }
    const dvEsperado = 11 - (suma % 11);
    const dvFinal = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : dvEsperado.toString();
    return dv === dvFinal;
};

// Formatear RUT
const formatearRUT = (rut) => {
    const rutLimpio = rut.replace(/\./g, '').replace(/-/g, '');
    if (rutLimpio.length <= 1) return rutLimpio;
    const cuerpo = rutLimpio.slice(0, -1);
    const dv = rutLimpio.slice(-1);
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
};

// --- COMPONENTES ---

// 0. Login y Registro
const AuthView = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({
        rut: '',
        nombre: '', // Mantenemos nombre y apellido separados para el formulario
        apellido: '',
        fechaNacimiento: '',
        idGenero: '', // --- CAMBIO: Ahora será el ID numérico
        email: '',
        telefono: '',
        password: '',
        confirmPassword: ''
    });

    // --- CAMBIO: Nuevo estado para cargar géneros desde la API ---
    const [generos, setGeneros] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [apiError, setApiError] = useState(''); // Para errores de API
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);

    // --- CAMBIO: Cargar géneros desde la API al montar ---
    useEffect(() => {
        const fetchGeneros = async () => {
            try {
                const response = await fetch(`${API_URL}/generos`);
                if (!response.ok) throw new Error('No se pudieron cargar los géneros');
                const data = await response.json();
                setGeneros(data);
            } catch (error) {
                console.error("Error fetching generos:", error);
                setApiError('Error al cargar datos. Intente más tarde.');
            }
        };
        fetchGeneros();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        
        if (name === 'rut') {
            const rutLimpio = value.replace(/\./g, '').replace(/-/g, '');
            if (rutLimpio.length <= 9 && /^[\dkK]*$/.test(rutLimpio)) {
                setFormData(prev => ({ ...prev, [name]: rutLimpio }));
            }
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
        
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
        if (apiError) setApiError('');
    };

    const validateForm = () => {
        const newErrors = {};
        if (!validarRUT(formData.rut)) newErrors.rut = 'RUT inválido';
        if (!formData.password) newErrors.password = 'La contraseña es requerida';
        else if (!isLogin && formData.password.length < 6) newErrors.password = 'La contraseña debe tener al menos 6 caracteres';

        if (!isLogin) {
            if (!formData.nombre.trim()) newErrors.nombre = 'El nombre es requerido';
            if (!formData.apellido.trim()) newErrors.apellido = 'El apellido es requerido';
            if (!formData.fechaNacimiento) newErrors.fechaNacimiento = 'La fecha de nacimiento es requerida';
            if (!formData.idGenero) newErrors.idGenero = 'El género es requerido';
            if (!formData.email.trim()) newErrors.email = 'El email es requerido';
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Email inválido';
            if (!formData.telefono.trim()) newErrors.telefono = 'El teléfono es requerido';
            else if (!/^\+?[\d\s-]{8,}$/.test(formData.telefono)) newErrors.telefono = 'Teléfono inválido';
            if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Las contraseñas no coinciden';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // --- CAMBIO: handleSubmit ahora usa fetch para llamar a la API ---
// --- CAMBIO: handleSubmit ahora usa fetch para llamar a la API ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;
        setIsLoading(true);
        setApiError('');

        try {
            if (isLogin) {
                // --- Lógica de LOGIN con API ---
                const response = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rut: formData.rut,
                        password: formData.password
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'RUT o contraseña incorrectos');
                }
                
                // onLogin espera { token, user }
                onLogin(data); 

            } else {
                // --- Lógica de REGISTRO con API ---
                const response = await fetch(`${API_URL}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rut: formData.rut,
                        nombrePaciente: `${formData.nombre} ${formData.apellido}`, 
                        fechaNacimiento: formData.fechaNacimiento,
                        idGenero: parseInt(formData.idGenero),
                        mail: formData.email,
                        telefono: formData.telefono,
                        password: formData.password
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'No se pudo registrar');
                }
                
                // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
                // Si el registro es exitoso, hacemos login manualmente.
                // Ya no llamamos a 'handleSubmit(e)'
                
                const loginResponse = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rut: formData.rut,
                        password: formData.password // Usamos la contraseña que el usuario acaba de escribir
                    })
                });

                const loginData = await loginResponse.json();
                if (!loginResponse.ok) {
                    // Esto no debería pasar, pero por si acaso
                    throw new Error(loginData.error || 'Error al iniciar sesión después del registro');
                }
                
                // Si el login SÍ funciona, llamamos a onLogin
                onLogin(loginData);
                // --- FIN DE LA CORRECCIÓN ---
            }
        } catch (error) {
            console.error('Auth Error:', error);
            setApiError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setIsLogin(!isLogin);
        setFormData({
            rut: '', nombre: '', apellido: '', fechaNacimiento: '', idGenero: '',
            email: '', telefono: '', password: '', confirmPassword: ''
        });
        setErrors({});
        setApiError('');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
                <div className="text-center mb-8">
                    {/* ... (ícono y título sin cambios) ... */}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* ... (campo RUT sin cambios) ... */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
                        <input
                            type="text"
                            name="rut"
                            value={formatearRUT(formData.rut)}
                            onChange={handleChange}
                            placeholder="12.345.678-9"
                            className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.rut ? 'border-red-500' : 'border-gray-300'}`}
                        />
                        {errors.rut && <p className="text-red-500 text-xs mt-1">{errors.rut}</p>}
                    </div>

                    {!isLogin && (
                        <>
                            {/* ... (campos nombre, apellido, fechaNacimiento sin cambios) ... */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                                    <input
                                        type="text"
                                        name="nombre"
                                        value={formData.nombre}
                                        onChange={handleChange}
                                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.nombre ? 'border-red-500' : 'border-gray-300'}`}
                                    />
                                    {errors.nombre && <p className="text-red-500 text-xs mt-1">{errors.nombre}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Apellido</label>
                                    <input
                                        type="text"
                                        name="apellido"
                                        value={formData.apellido}
                                        onChange={handleChange}
                                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.apellido ? 'border-red-500' : 'border-gray-300'}`}
                                    />
                                    {errors.apellido && <p className="text-red-500 text-xs mt-1">{errors.apellido}</p>}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Nacimiento</label>
                                <input
                                    type="date"
                                    name="fechaNacimiento"
                                    value={formData.fechaNacimiento}
                                    onChange={handleChange}
                                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.fechaNacimiento ? 'border-red-500' : 'border-gray-300'}`}
                                />
                                {errors.fechaNacimiento && <p className="text-red-500 text-xs mt-1">{errors.fechaNacimiento}</p>}
                            </div>
                            
                            {/* --- CAMBIO: Dropdown de Género ahora es dinámico --- */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Género</label>
                                <select
                                    name="idGenero"
                                    value={formData.idGenero}
                                    onChange={handleChange}
                                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.idGenero ? 'border-red-500' : 'border-gray-300'}`}
                                >
                                    <option value="">Seleccionar</option>
                                    {generos.map((g) => (
                                        <option key={g.idGenero} value={g.idGenero}>
                                            {g.genero}
                                        </option>
                                    ))}
                                </select>
                                {errors.idGenero && <p className="text-red-500 text-xs mt-1">{errors.idGenero}</p>}
                            </div>

                            {/* ... (campos email y telefono sin cambios) ... */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="ejemplo@correo.com"
                                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.email ? 'border-red-500' : 'border-gray-300'}`}
                                />
                                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                                <input
                                    type="tel"
                                    name="telefono"
                                    value={formData.telefono}
                                    onChange={handleChange}
                                    placeholder="+56 9 1234 5678"
                                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.telefono ? 'border-red-500' : 'border-gray-300'}`}
                                />
                                {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono}</p>}
                            </div>
                        </>
                    )}

                    {/* ... (campos de contraseña sin cambios) ... */}
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.password ? 'border-red-500' : 'border-gray-300'}`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                            >
                                {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                        {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                    </div>

                    {!isLogin && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Contraseña</label>
                            <input
                                type={showPassword ? "text" : "password"}
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.confirmPassword ? 'border-red-500' : 'border-gray-300'}`}
                            />
                            {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword}</p>}
                        </div>
                    )}

                    {/* --- CAMBIO: Mostrar error de API --- */}
                    {apiError && (
                        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-center">
                            {apiError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition duration-200 shadow-lg disabled:bg-gray-400"
                    >
                        {isLoading ? (isLogin ? 'Ingresando...' : 'Registrando...') : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
                    </button>
                </form>

                {/* ... (toggleMode sin cambios) ... */}
                <div className="mt-6 text-center">
                    <p className="text-gray-600">
                        {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
                        <button
                            onClick={toggleMode}
                            className="text-blue-600 font-semibold ml-2 hover:underline"
                        >
                            {isLogin ? 'Regístrate aquí' : 'Inicia sesión'}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

// 1. DoctorAvatar
// --- CAMBIO: Actualizado para usar 'nombrePaciente' del backend ---
const DoctorAvatar = ({ user }) => (
    <aside className="hidden lg:flex flex-col w-1/3 p-8 bg-blue-600 justify-center items-center text-white text-center rounded-l-3xl shadow-xl">
        {/* ... (SVG sin cambios) ... */}
        <h2 className="text-3xl font-bold mb-2">Dr. Asistente IA</h2>
        <p className="text-sm opacity-90 italic">
            Bienvenido, {user.nombrePaciente} 
        </p>
        <p className="text-xs opacity-75 mt-1">
            RUT: {formatearRUT(user.rut)}
        </p>
        <div className="mt-8 pt-4 border-t border-blue-400/50">
            <p className="text-xs opacity-70">"Tu compañero virtual para una salud sin esperas."</p>
        </div>
    </aside>
);

// 2. Navbar (Sin cambios)
const Navbar = ({ view, setView, onLogout }) => {
    // ... (código del Navbar sin cambios) ...
        const commonClasses = "px-4 py-2 font-semibold transition duration-150 rounded-lg";
    const activeClasses = "bg-white text-blue-600 shadow-md";
    const inactiveClasses = "text-gray-600 hover:bg-gray-100";

    return (
        <header className="p-4 md:p-6 bg-white border-b border-gray-200 flex items-center justify-between">
            <h1 className="text-xl md:text-3xl font-bold text-blue-600 flex items-center">
                <svg className="w-6 h-6 md:w-8 md:h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                </svg>
                Asistente Médico IA
            </h1>
            <div className="flex items-center space-x-2">
                <nav className="flex space-x-2">
                    <button 
                        className={`${commonClasses} ${view === 'chat' ? activeClasses : inactiveClasses}`}
                        onClick={() => setView('chat')}
                    >
                        Pedir Hora
                    </button>
                    <button 
                        className={`${commonClasses} ${view === 'appointments' ? activeClasses : inactiveClasses}`}
                        onClick={() => setView('appointments')}
                    >
                        Mis Reservas
                    </button>
                </nav>
                <button
                    onClick={onLogout}
                    className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition duration-150"
                    title="Cerrar Sesión"
                >
                    Salir
                </button>
            </div>
        </header>
    );
};

// 3. ChatView
// --- CAMBIO: Conectado a la API. Se pasa 'token' ---
const ChatView = ({ chatHistory, setChatHistory, isProcessing, setIsProcessing, setAppointments, token }) => {
    const userInputRef = useRef(null);
    const chatWindowRef = useRef(null);

    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
        if (userInputRef.current) {
            userInputRef.current.focus();
        }
    }, [chatHistory, isProcessing]);

    // --- CAMBIO: Eliminada la función 'generateMockResponse' ---

    // --- CAMBIO: sendMessage ahora llama a POST /api/chat ---
    const sendMessage = async (e) => {
        if (e) e.preventDefault();
        
        const prompt = userInputRef.current.value.trim();
        if (!prompt || isProcessing) return;

        userInputRef.current.value = '';
        userInputRef.current.style.height = 'auto';
        setIsProcessing(true);

        const newUserMessage = { role: 'user', text: prompt, id: Date.now() };
        setChatHistory(prev => [...prev, newUserMessage]);
        
        const loadingElement = { role: 'ai', text: '...', id: 'loading' };
        setChatHistory(prev => [...prev, loadingElement]);

        try {
            // Llamada real a la API del backend
            const response = await fetch(`${API_URL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Enviamos el token para autenticación
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ prompt: prompt })
            });

            if (!response.ok) {
                throw new Error('Error en la respuesta de la IA');
            }

            const aiResponse = await response.json(); // { role: 'ai', text: '...', id: ... }

            setChatHistory(prev => prev.filter(msg => msg.id !== 'loading'));
            setChatHistory(prev => [...prev, aiResponse]);

            // Si la respuesta indica una reserva, actualizamos la lista
            // (El backend ahora nos dice si se completó una reserva)
            if (aiResponse.text.includes('Reserva completada')) {
                // Le pedimos al componente padre que recargue las citas
                setAppointments(null); // Esto forzará un 'refresh' en App.jsx
            }

        } catch (error) {
            console.error("Error:", error);
            setChatHistory(prev => prev.filter(msg => msg.id !== 'loading'));
            setChatHistory(prev => [...prev, { role: 'ai', text: 'Lo siento, hubo un error. Por favor, inténtalo de nuevo.', id: Date.now() + 2 }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const ChatBubble = ({ message }) => {
        // ... (código de ChatBubble sin cambios) ...
        const isUser = message.role === 'user';
        const bubbleClasses = isUser 
            ? 'bg-blue-100 text-gray-700 rounded-br-none' 
            : 'bg-white border-l-4 border-blue-600 text-gray-800 rounded-tl-none shadow-sm';

        const formatText = (text) => {
            let formatted = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');

            if (text === '...') {
                formatted = `<span class="animate-pulse">.</span><span class="animate-pulse delay-100">.</span><span class="animate-pulse delay-200">.</span>`;
            }

            return { __html: formatted };
        };

        return (
            <div className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs md:max-w-md lg:max-w-lg p-4 rounded-xl shadow-lg transition duration-300 ${bubbleClasses}`}>
                    <div dangerouslySetInnerHTML={formatText(message.text)} />
                </div>
            </div>
        );
    };

    return (
        <div className="flex-grow flex flex-col h-full">
            {/* ... (main y footer del chat sin cambios) ... */}
            <main ref={chatWindowRef} className="flex-grow p-4 md:p-6 overflow-y-auto" style={{ minHeight: 0 }}>
                {chatHistory.map((msg) => (
                    <ChatBubble key={msg.id} message={msg} />
                ))}
            </main>

            <footer className="p-4 border-t border-gray-200 bg-blue-50">
                <div className="relative flex items-center">
                    <textarea 
                        ref={userInputRef}
                        placeholder={isProcessing ? "Procesando respuesta..." : "Escribe tu necesidad de cita o pregunta aquí..."}
                        rows="1"
                        disabled={isProcessing}
                        className="w-full resize-none p-4 pr-12 text-lg rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-md transition duration-150 border-gray-300 disabled:bg-gray-100"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                        onInput={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = (e.target.scrollHeight) + 'px';
                        }}
                    />
                    <button 
                        onClick={sendMessage}
                        disabled={isProcessing}
                        className="absolute right-2 bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                        </svg>
                    </button>
                </div>
                <p className="text-xs text-gray-400 mt-2 text-center">Tus interacciones son privadas y protegidas.</p>
            </footer>
        </div>
    );
};

// 4. Appointments
// --- CAMBIO: Ahora recibe 'appointments' como prop, ya no las maneja localmente ---
const Appointments = ({ appointments }) => {
    const [activeTab, setActiveTab] = useState('current');

    // --- CAMBIO: La lógica de filtrado ahora depende de las props ---
    const currentAppointments = appointments.filter(appt => !appt.isPast);
    const pastAppointments = appointments.filter(appt => appt.isPast);

    const AppointmentCard = ({ appt, isPast }) => {
        // ... (código de AppointmentCard sin cambios) ...
        const currentClasses = 'bg-white shadow-lg border-t-4 border-blue-500 hover:shadow-xl';
        const currentStatusClasses = 'bg-green-100 text-green-700 border-green-400 border';
        
        const pastClasses = 'bg-gray-100 shadow-sm border-l-4 border-gray-300';
        const pastStatusClasses = 'bg-gray-200 text-gray-500 border-gray-400 border';
        
        const cardClasses = isPast ? pastClasses : currentClasses;
        const statusClasses = isPast ? pastStatusClasses : currentStatusClasses;
        const statusText = isPast ? 'Completada' : 'Confirmada'; 
        const dateStyle = isPast ? 'text-gray-500' : 'text-gray-900 font-bold';

        return (
            <div className={`p-6 rounded-xl transition duration-300 ${cardClasses}`}>
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-bold text-gray-800">{appt.specialty}</h3>
                        <p className="text-sm text-blue-500 font-medium mt-1">
                            {appt.doctor}
                        </p>
                    </div>
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusClasses}`}>
                        {statusText}
                    </span>
                </div>
                
                <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
                    <div className="text-sm">
                        <p className="text-gray-500 font-medium">Fecha</p>
                        <p className={dateStyle}>{appt.date}</p>
                    </div>
                    <div className="text-sm">
                        <p className="text-gray-500 font-medium">Hora</p>
                        <p className={dateStyle}>{appt.time}</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-gray-50">
            {/* ... (título y pestañas sin cambios) ... */}
             <h2 className="text-3xl font-bold text-gray-700 mb-6 border-b pb-2">Mis Reservas</h2>

            <div className="flex space-x-6 mb-6 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('current')}
                    className={`pb-3 font-semibold text-lg transition duration-200 ${
                        activeTab === 'current'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-500 hover:text-blue-500'
                    }`}
                >
                    Citas Actuales
                </button>
                <button
                    onClick={() => setActiveTab('past')}
                    className={`pb-3 font-semibold text-lg transition duration-200 ${
                        activeTab === 'past'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-500 hover:text-blue-500'
                    }`}
                >
                    Historial
                </button>
            </div>

            {/* ... (renderizado de pestañas sin cambios, ahora usa props) ... */}
            {activeTab === 'current' && (
                currentAppointments.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {currentAppointments.map((appt) => (
                            <AppointmentCard key={appt.id} appt={appt} isPast={false} />
                        ))}
                    </div>
                ) : (
                    <div className="p-10 text-center text-gray-500 bg-white rounded-xl shadow-md border border-dashed border-gray-300">
                        {/* ... (mensaje 'No tienes citas') ... */}
                    </div>
                )
            )}

            {activeTab === 'past' && (
                pastAppointments.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {pastAppointments.map((appt) => (
                            <AppointmentCard key={appt.id} appt={appt} isPast={true} />
                        ))}
                    </div>
                ) : (
                    <div className="p-10 text-center text-gray-500 bg-white rounded-xl shadow-md border border-dashed border-gray-300">
                         {/* ... (mensaje 'Tu historial está vacío') ... */}
                    </div>
                )
            )}
        </div>
    );
};

// 5. App (Componente Principal)
// --- CAMBIOS IMPORTANTES: Lógica de autenticación por Token ---
const App = () => {
    const [currentUser, setCurrentUser] = useState(null);
    const [token, setToken] = useState(() => localStorage.getItem('medicalToken')); // Guardamos el token
    const [view, setView] = useState('chat');
    const [authLoading, setAuthLoading] = useState(true); // Estado para validar sesión

    const [chatHistory, setChatHistory] = useState([
        { role: 'ai', text: '¡Hola! Soy tu asistente médico virtual. ¿Qué tipo de cita o especialista estás buscando hoy?', id: 'initial' }
    ]);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // --- CAMBIO: Appointments inicia vacío y se carga desde la API ---
    const [appointments, setAppointments] = useState([]);
    const [isLoadingAppts, setIsLoadingAppts] = useState(true);

    // --- CAMBIO: Validar token al cargar la app ---
    useEffect(() => {
        const validateSession = async () => {
            if (token) {
                try {
                    const response = await fetch(`${API_URL}/api/profile`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error('Sesión inválida');
                    
                    const userData = await response.json();
                    setCurrentUser(userData); // El backend devuelve los datos del paciente
                } catch (error) {
                    console.error("Session validation error:", error);
                    handleLogout(); // Si el token es malo, limpiamos
                }
            }
            setAuthLoading(false);
        };
        validateSession();
    }, [token]);

    // --- CAMBIO: Cargar citas reales cuando el usuario existe o cambian las citas ---
    useEffect(() => {
        if (currentUser) {
            // Si 'appointments' es null, es una señal de ChatView para recargar
            if (appointments === null) {
                setIsLoadingAppts(true);
            }
            
            const fetchAppointments = async () => {
                try {
                    const response = await fetch(`${API_URL}/api/consultas`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error('No se pudieron cargar las citas');
                    const data = await response.json();
                    setAppointments(data);
                } catch (error) {
                    console.error("Error fetching appointments:", error);
                } finally {
                    setIsLoadingAppts(false);
                }
            };
            fetchAppointments();
        }
    }, [currentUser, token, appointments === null]); // Se ejecuta si 'appointments' se setea a null

    // --- CAMBIO: handleLogin ahora guarda el token ---
    const handleLogin = (data) => {
        // 'data' es { token, user } desde nuestro backend
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('medicalToken', data.token);
    };

    // --- CAMBIO: handleLogout limpia el token ---
    const handleLogout = () => {
        setToken(null);
        setCurrentUser(null);
        localStorage.removeItem('medicalToken');
        setChatHistory([
            { role: 'ai', text: '¡Hola! Soy tu asistente médico virtual. ¿Qué tipo de cita o especialista estás buscando hoy?', id: 'initial' }
        ]);
        setAppointments([]);
        setView('chat');
    };

    // Muestra un loader mientras se valida el token
    if (authLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                <div className="text-xl font-semibold text-blue-600">Validando sesión...</div>
            </div>
        );
    }

    // Si no hay usuario (ni token válido), muestra la vista de Auth
    if (!currentUser) {
        return <AuthView onLogin={handleLogin} />;
    }

    // Si hay usuario, muestra la app principal
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="w-full max-w-6xl h-[90vh] flex bg-white rounded-3xl shadow-2xl overflow-hidden">
                <DoctorAvatar user={currentUser} />
                <div className="flex-grow flex flex-col">
                    <Navbar view={view} setView={setView} onLogout={handleLogout} />
                    <div className="flex-grow overflow-hidden">
                        {view === 'chat' && (
                            <ChatView 
                                chatHistory={chatHistory} 
                                setChatHistory={setChatHistory} 
                                isProcessing={isProcessing} 
                                setIsProcessing={setIsProcessing}
                                // Pasamos 'setAppointments' para que el chat pueda pedir recarga
                                setAppointments={setAppointments} 
                                token={token} // Pasamos el token para la API
                            />
                        )}
                        {view === 'appointments' && (
                            // Pasamos las citas cargadas
                            <Appointments appointments={appointments} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;