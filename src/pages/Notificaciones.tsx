import { useState } from "react";
import { 
  BellOff, Check, ArrowLeft, Trash2, 
  Coins, Trophy, Sparkles, X 
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// Definición de la interfaz para las notificaciones
interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "deposit" | "tier" | "system";
}

// Datos iniciales alineados a Vyn
const mockNotifications: Notification[] = [
  {
    id: "1",
    title: "Depósito confirmado",
    message: "Tus 50 USDC ya están en el contrato inteligente generando reputación.",
    time: "Hace 2 horas",
    read: false,
    type: "deposit",
  },
  {
    id: "2",
    title: "¡Nivel Plata disponible! 🥈",
    message: "Tu puntaje superó los 50 pts. Ya puedes reclamar tu NFT de Nivel Plata.",
    time: "Hace 1 día",
    read: false,
    type: "tier",
  },
  {
    id: "3",
    title: "Bienvenido a Vyn",
    message: "Conecta tu Freighter para empezar a construir tu historial financiero.",
    time: "Hace 3 días",
    read: true,
    type: "system",
  },
];

const Notificaciones = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Funciones de gestión
  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  // 🛡️ FUNCIÓN CORREGIDA: Recibe el ID y el evento MouseEvent de React
  const deleteNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Evita que se dispare el markRead al hacer click en el botón de borrar
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const clearAll = () => {
    if (window.confirm("¿Borrar todas las notificaciones?")) {
      setNotifications([]);
    }
  };

  // Helper para iconos dinámicos
  const getIcon = (type: string) => {
    switch (type) {
      case "deposit": return <Coins className="w-5 h-5 text-primary" />;
      case "tier": return <Trophy className="w-5 h-5 text-accent" />;
      default: return <Sparkles className="w-5 h-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-nunito">
      {/* Header */}
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center active:scale-90 transition-all"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground tracking-tight">Notificaciones</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {unreadCount} nuevas hoy
          </p>
        </div>
        {notifications.length > 0 && (
          <button
            onClick={clearAll}
            className="p-2 rounded-lg text-muted-foreground hover:text-red-500 transition-colors"
            title="Borrar todo"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </header>

      <main className="px-5 max-w-md md:max-w-2xl mx-auto">
        {/* Botón rápido para marcar como leído */}
        {notifications.length > 0 && unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="w-full mb-4 py-2 bg-primary/10 text-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <Check className="w-3.5 h-3.5" /> Marcar todas como leídas
          </button>
        )}

        {/* Lista de Notificaciones */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
              <BellOff className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-foreground">Bandeja vacía</p>
            <p className="text-xs text-muted-foreground px-10">
              No tienes novedades por ahora. ¡Te avisaremos ante cualquier cambio!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n, i) => (
              <div
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`relative overflow-hidden card-elevated flex items-start gap-4 px-5 py-4 cursor-pointer transition-all active:scale-[0.98] animate-fade-up ${
                  !n.read ? "border-l-4 border-l-primary bg-primary/[0.02]" : "opacity-75"
                }`}
                style={{ animationDelay: `${i * 80}ms`, animationFillMode: "forwards" }}
              >
                <div className="mt-1">{getIcon(n.type)}</div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${!n.read ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}>
                      {n.title}
                    </p>
                    {/* 🛡️ BOTÓN DE BORRAR CON TIPO DE EVENTO EXPLÍCITO */}
                    <button 
                      onClick={(e) => deleteNotification(n.id, e)}
                      className="text-muted-foreground/30 hover:text-red-400 transition-colors p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    {n.message}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground/50 mt-2 uppercase tracking-tighter">
                    {n.time}
                  </p>
                </div>

                {!n.read && (
                  <div className="absolute top-4 right-2 w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Notificaciones;