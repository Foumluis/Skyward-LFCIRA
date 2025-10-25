import React, { useState, useEffect, useRef } from 'react';

// --- UTILIDADES ---

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
        nombre: '',
        apellido: '',
        fechaNacimiento: '',
        genero: '',
        email: '',
        telefono: '',
        password: '',
        confirmPassword: ''
    });
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);

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
        
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const validateForm = () => {
        const newErrors = {};

        if (!validarRUT(formData.rut)) {
            newErrors.rut = 'RUT inválido';
        }

        if (!formData.password) {
            newErrors.password = 'La contraseña es requerida';
        } else if (!isLogin && formData.password.length < 6) {
            newErrors.password = 'La contraseña debe tener al menos 6 caracteres';
        }

        if (!isLogin) {
            if (!formData.nombre.trim()) newErrors.nombre = 'El nombre es requerido';
            if (!formData.apellido.trim()) newErrors.apellido = 'El apellido es requerido';
            if (!formData.fechaNacimiento) newErrors.fechaNacimiento = 'La fecha de nacimiento es requerida';
            if (!formData.genero) newErrors.genero = 'El género es requerido';
            if (!formData.email.trim()) {
                newErrors.email = 'El email es requerido';
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
                newErrors.email = 'Email inválido';
            }
            if (!formData.telefono.trim()) {
                newErrors.telefono = 'El teléfono es requerido';
            } else if (!/^\+?[\d\s-]{8,}$/.test(formData.telefono)) {
                newErrors.telefono = 'Teléfono inválido';
            }
            if (formData.password !== formData.confirmPassword) {
                newErrors.confirmPassword = 'Las contraseñas no coinciden';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        if (!validateForm()) return;

        if (isLogin) {
            // Verificar credenciales
            const users = JSON.parse(localStorage.getItem('medicalUsers') || '[]');
            const user = users.find(u => u.rut === formData.rut && u.password === formData.password);
            
            if (user) {
                onLogin(user);
            } else {
                setErrors({ password: 'RUT o contraseña incorrectos' });
            }
        } else {
            // Registrar nuevo usuario
            const users = JSON.parse(localStorage.getItem('medicalUsers') || '[]');
            
            if (users.find(u => u.rut === formData.rut)) {
                setErrors({ rut: 'Este RUT ya está registrado' });
                return;
            }

            const newUser = {
                rut: formData.rut,
                nombre: formData.nombre,
                apellido: formData.apellido,
                fechaNacimiento: formData.fechaNacimiento,
                genero: formData.genero,
                email: formData.email,
                telefono: formData.telefono,
                password: formData.password,
                createdAt: new Date().toISOString()
            };

            users.push(newUser);
            localStorage.setItem('medicalUsers', JSON.stringify(users));
            onLogin(newUser);
        }
    };

    const toggleMode = () => {
        setIsLogin(!isLogin);
        setFormData({
            rut: '',
            nombre: '',
            apellido: '',
            fechaNacimiento: '',
            genero: '',
            email: '',
            telefono: '',
            password: '',
            confirmPassword: ''
        });
        setErrors({});
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-4">
                        <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-gray-800">Asistente Médico IA</h1>
                    <p className="text-gray-500 mt-2">{isLogin ? 'Inicia sesión en tu cuenta' : 'Crea tu cuenta nueva'}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Género</label>
                                <select
                                    name="genero"
                                    value={formData.genero}
                                    onChange={handleChange}
                                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.genero ? 'border-red-500' : 'border-gray-300'}`}
                                >
                                    <option value="">Seleccionar</option>
                                    <option value="masculino">Masculino</option>
                                    <option value="femenino">Femenino</option>
                                    <option value="otro">Otro</option>
                                    <option value="prefiero_no_decir">Prefiero no decir</option>
                                </select>
                                {errors.genero && <p className="text-red-500 text-xs mt-1">{errors.genero}</p>}
                            </div>

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

                    <button
                        type="submit"
                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition duration-200 shadow-lg"
                    >
                        {isLogin ? 'Iniciar Sesión' : 'Registrarse'}
                    </button>
                </form>

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
const DoctorAvatar = ({ user }) => (
    <aside className="hidden lg:flex flex-col w-1/3 p-8 bg-blue-600 justify-center items-center text-white text-center rounded-l-3xl shadow-xl">
        <svg className="w-48 h-48 mb-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 4C13.66 4 15 5.34 15 7C15 8.66 13.66 10 12 10C10.34 10 9 8.66 9 7C9 5.34 10.34 4 12 4ZM17 19H7C6.45 19 6 18.55 6 18V17C6 14.33 11.33 13.5 12 13.5C12.67 13.5 18 14.33 18 17V18C18 18.55 17.55 19 17 19Z" fill="#fff"/>
            <circle cx="12" cy="7.5" r="2.5" fill="#fff"/>
            <path fill="#007bff" d="M11 5h2v4h4v2h-4v4h-2v-4H7V9h4z"/>
        </svg>

        <h2 className="text-3xl font-bold mb-2">Dr. Asistente IA</h2>
        <p className="text-sm opacity-90 italic">
            Bienvenido, {user.nombre} {user.apellido}
        </p>
        <p className="text-xs opacity-75 mt-1">
            RUT: {formatearRUT(user.rut)}
        </p>
        <div className="mt-8 pt-4 border-t border-blue-400/50">
            <p className="text-xs opacity-70">"Tu compañero virtual para una salud sin esperas."</p>
        </div>
    </aside>
);

// 2. Navbar
const Navbar = ({ view, setView, onLogout }) => {
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
const ChatView = ({ chatHistory, setChatHistory, isProcessing, setIsProcessing, setAppointments }) => {
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

    const checkAndSaveAppointment = (text) => {
        if (text.includes('Reserva completada') || text.includes('programada')) {
            const newAppointment = {
                id: Date.now().toString(),
                specialty: text.includes('Cardiología') ? 'Cardiología' : 'Medicina General',
                doctor: text.match(/Dr\. [A-Za-zá-úÁ-Ú]+/)?.[0] || 'Dr. IA',
                date: text.match(/\d{1,2} de \w+/)?.[0] || 'Próximo Lunes',
                time: text.match(/\d{1,2}:\d{2} [A|P]M/)?.[0] || '10:00 AM',
                status: 'Confirmada', 
                isPast: false,
                createdAt: new Date().toISOString()
            };
            
            setAppointments(prev => [...prev, newAppointment]);
            return true;
        }
        return false;
    };

    const generateMockResponse = (userPrompt) => {
        const p = userPrompt.toLowerCase();
        if (p.includes('citas') || p.includes('horas') || p.includes('hola')) {
            return "Entiendo. Para poder reservarte una hora, necesito saber qué especialidad buscas (ej. **Odontología**, **Pediatría**, **Cardiología**) y si tienes alguna preferencia de día o doctor.";
        } else if (p.includes('dolor') || p.includes('sintomas') || p.includes('síntomas')) {
            return "Lamento que no te sientas bien. Para asistirte, por favor, dime la especialidad que necesitas o la **fecha y hora** exacta que buscas.";
        } else if (p.includes('confirmar') || (p.includes('cardiologia') && (p.includes('martes') || p.includes('mañana')))) {
            return "¡**Reserva completada!** La hora con el **Dr. Smith** en **Cardiología** queda programada para el *15 de noviembre a las 11:00 AM*. Recibirás un recordatorio por correo.";
        } else if (p.includes('pediatria') || p.includes('cardiologia') || p.includes('odontologia') || p.includes('medicina general')) {
            return "Perfecto, ¿para cuándo te gustaría la cita? Estoy viendo horas disponibles para la próxima semana, *por ejemplo, el martes por la tarde*.";
        } else {
            return "Para continuar, ¿me indicas la especialidad y si necesitas alguna fecha u horario específico?";
        }
    };

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
            await new Promise(resolve => setTimeout(resolve, 1000));
            const aiResponse = generateMockResponse(prompt);
            
            setChatHistory(prev => prev.filter(msg => msg.id !== 'loading'));

            const newAiMessage = { role: 'ai', text: aiResponse, id: Date.now() + 1 };
            setChatHistory(prev => [...prev, newAiMessage]);

            checkAndSaveAppointment(aiResponse);

        } catch (error) {
            console.error("Error:", error);
            setChatHistory(prev => prev.filter(msg => msg.id !== 'loading'));
            setChatHistory(prev => [...prev, { role: 'ai', text: 'Lo siento, hubo un error. Por favor, inténtalo de nuevo.', id: Date.now() + 2 }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const ChatBubble = ({ message }) => {
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
const Appointments = ({ appointments }) => {
    const [activeTab, setActiveTab] = useState('current');

    const currentAppointments = appointments.filter(appt => !appt.isPast);
    const pastAppointments = appointments.filter(appt => appt.isPast);

    const AppointmentCard = ({ appt, isPast }) => {
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

            {activeTab === 'current' && (
                currentAppointments.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {currentAppointments.map((appt) => (
                            <AppointmentCard key={appt.id} appt={appt} isPast={false} />
                        ))}
                    </div>
                ) : (
                    <div className="p-10 text-center text-gray-500 bg-white rounded-xl shadow-md border border-dashed border-gray-300">
                        <svg className="w-16 h-16 mx-auto mb-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <p className="text-xl font-semibold">No tienes citas médicas confirmadas actualmente.</p>
                        <p className="mt-2">Utiliza la pestaña 'Pedir Hora' para comenzar a programar.</p>
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
                        <p className="text-xl font-semibold">Tu historial de citas médicas está vacío.</p>
                        <p className="mt-2">Una vez completes una cita, aparecerá aquí.</p>
                    </div>
                )
            )}
        </div>
    );
};

// 5. App (Componente Principal)
const App = () => {
    const [currentUser, setCurrentUser] = useState(null);
    const [view, setView] = useState('chat');

    const [chatHistory, setChatHistory] = useState([
        { 
            role: 'ai', 
            text: '¡Hola! Soy tu asistente médico virtual. ¿Qué tipo de cita o especialista estás buscando hoy?', 
            id: 'initial' 
        }
    ]);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [appointments, setAppointments] = useState([
        {
            id: 'mock_current',
            specialty: 'Medicina General',
            doctor: 'Dra. María Paz',
            date: 'Próximo Martes',
            time: '16:00 PM',
            status: 'Confirmada',
            isPast: false,
        },
        {
            id: 'mock_past_1',
            specialty: 'Pediatría',
            doctor: 'Dr. Javier López',
            date: '05 de Septiembre',
            time: '10:30 AM',
            status: 'Completada',
            isPast: true,
        },
        {
            id: 'mock_past_2',
            specialty: 'Cardiología',
            doctor: 'Dra. Elena García',
            date: '10 de Julio',
            time: '11:00 AM',
            status: 'Completada',
            isPast: true,
        },
    ]);

    // Verificar sesión al cargar
    useEffect(() => {
        const savedSession = localStorage.getItem('medicalSession');
        if (savedSession) {
            setCurrentUser(JSON.parse(savedSession));
        }
    }, []);

    // Persistencia de citas por usuario
    useEffect(() => {
        if (currentUser) {
            const key = `medicalAppointments_${currentUser.rut}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                setAppointments(JSON.parse(saved));
            }
        }
    }, [currentUser]);

    useEffect(() => {
        if (currentUser) {
            const key = `medicalAppointments_${currentUser.rut}`;
            localStorage.setItem(key, JSON.stringify(appointments));
        }
    }, [appointments, currentUser]);

    const handleLogin = (user) => {
        setCurrentUser(user);
        localStorage.setItem('medicalSession', JSON.stringify(user));
    };

    const handleLogout = () => {
        setCurrentUser(null);
        localStorage.removeItem('medicalSession');
        setChatHistory([
            { 
                role: 'ai', 
                text: '¡Hola! Soy tu asistente médico virtual. ¿Qué tipo de cita o especialista estás buscando hoy?', 
                id: 'initial' 
            }
        ]);
        setView('chat');
    };

    if (!currentUser) {
        return <AuthView onLogin={handleLogin} />;
    }

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
                                setAppointments={setAppointments}
                            />
                        )}
                        {view === 'appointments' && (
                            <Appointments appointments={appointments} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;