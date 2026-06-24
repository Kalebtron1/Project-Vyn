import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import WalletSetupModal from "@/components/WalletSetupModal";
import Index from "./pages/Index.tsx";
import Historial from "./pages/Historial.tsx";
import Perfil from "./pages/Perfil.tsx";
import Retiros from "./pages/Retiros.tsx";
import Tesoreria from "./pages/Tesoreria.tsx";
import Onboarding from "./pages/Onboarding.tsx";
import Login from "./pages/Login.tsx";
import Notificaciones from "./pages/Notificaciones.tsx";
import Ayuda from "./pages/Ayuda.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const isOnboarded = () => localStorage.getItem("vinculo_onboarded") === "1";
const hasWallet = () => !!localStorage.getItem("vinculo_wallet");

const RequireWallet = ({ children }: { children: React.ReactNode }) => {
  const [wallet, setWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedWallet = localStorage.getItem("vinculo_wallet");
    setWallet(savedWallet);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!wallet) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const WalletGate = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [needsWallet, setNeedsWallet] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("wallet_address")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        setNeedsWallet(!data?.wallet_address);
        setChecked(true);
      });
  }, [user]);

  if (!checked)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <>
      {needsWallet && (
        <WalletSetupModal
          onComplete={() => {
            // Re-check profile after modal closes so we don't show it again
            // if the save succeeded
            supabase
              .from("profiles")
              .select("wallet_address")
              .eq("user_id", user!.id)
              .single()
              .then(({ data }) => setNeedsWallet(!data?.wallet_address));
          }}
        />
      )}
      {children}
    </>
  );
};

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <WalletGate>{children}</WalletGate>;
};

const RequireOnboarding = ({ children }: { children: React.ReactNode }) =>
  isOnboarded() ? <>{children}</> : <Navigate to="/bienvenida" replace />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              {/* Login - sin RequireWallet, completamente público */}
              <Route path="/login" element={<Login />} />
              
              {/* Rutas protegidas por wallet */}
              <Route path="/bienvenida" element={<RequireWallet>{isOnboarded() ? <Navigate to="/" replace /> : <Onboarding />}</RequireWallet>} />
              <Route path="/" element={<RequireWallet><RequireOnboarding><Index /></RequireOnboarding></RequireWallet>} />
              <Route path="/historial" element={<RequireWallet><RequireOnboarding><Historial /></RequireOnboarding></RequireWallet>} />
              <Route path="/perfil" element={<RequireWallet><RequireOnboarding><Perfil /></RequireOnboarding></RequireWallet>} />
              <Route path="/retiros" element={<RequireWallet><RequireOnboarding><Retiros /></RequireOnboarding></RequireWallet>} />
              <Route path="/tesoreria" element={<RequireWallet><RequireOnboarding><Tesoreria /></RequireOnboarding></RequireWallet>} />
              <Route path="/notificaciones" element={<RequireWallet><RequireOnboarding><Notificaciones /></RequireOnboarding></RequireWallet>} />
              <Route path="/ayuda" element={<RequireWallet><RequireOnboarding><Ayuda /></RequireOnboarding></RequireWallet>} />
              
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
