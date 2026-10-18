import { lazy, Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrivyProvider } from "@privy-io/react-auth";
import { AppProvider } from "@/context/AppContext";
import { WalletSessionProvider, useWalletSession } from "@/context/WalletSessionContext";
import { PrivyBridge } from "@/components/PrivyBridge";

// Cada página se descarga bajo demanda para reducir el bundle inicial.
const Index = lazy(() => import("./pages/Index.tsx"));
const Historial = lazy(() => import("./pages/Historial.tsx"));
const Perfil = lazy(() => import("./pages/Perfil.tsx"));
const Retiros = lazy(() => import("./pages/Retiros.tsx"));
const Depositar = lazy(() => import("./pages/Depositar.tsx"));
const Tesoreria = lazy(() => import("./pages/Tesoreria.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Notificaciones = lazy(() => import("./pages/Notificaciones.tsx"));
const Ayuda = lazy(() => import("./pages/Ayuda.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

const RequireWallet = ({ children }: { children: React.ReactNode }) => {
  const { address, ready } = useWalletSession();
  // La sesión se carga una sola vez al arrancar; tras eso vive en memoria, así
  // que navegar entre rutas (volver a Inicio) ya no re-lee almacenamiento.
  if (!ready) return <Spinner />;
  if (!address) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const RequireOnboarding = ({ children }: { children: React.ReactNode }) => {
  const { onboarded } = useWalletSession();
  return onboarded ? <>{children}</> : <Navigate to="/bienvenida" replace />;
};

// Ruta /bienvenida: si ya completó onboarding, va directo a la app.
const BienvenidaRoute = () => {
  const { onboarded } = useWalletSession();
  return onboarded ? <Navigate to="/" replace /> : <Onboarding />;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
       <PrivyProvider
         appId={import.meta.env.VITE_PRIVY_APP_ID}
         config={{
           loginMethods: ["email", "google", "apple"],
           appearance: { theme: "light" },
         }}
       >
        <PrivyBridge />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <WalletSessionProvider>
            <Suspense fallback={<Spinner />}>
            <Routes>
              {/* Login - sin RequireWallet, completamente público */}
              <Route path="/login" element={<Login />} />

              {/* Rutas protegidas por wallet */}
              <Route path="/bienvenida" element={<RequireWallet><BienvenidaRoute /></RequireWallet>} />
              <Route path="/" element={<RequireWallet><RequireOnboarding><Index /></RequireOnboarding></RequireWallet>} />
              <Route path="/historial" element={<RequireWallet><RequireOnboarding><Historial /></RequireOnboarding></RequireWallet>} />
              <Route path="/perfil" element={<RequireWallet><RequireOnboarding><Perfil /></RequireOnboarding></RequireWallet>} />
              <Route path="/retiros" element={<RequireWallet><RequireOnboarding><Retiros /></RequireOnboarding></RequireWallet>} />
              <Route path="/depositar" element={<RequireWallet><RequireOnboarding><Depositar /></RequireOnboarding></RequireWallet>} />
              <Route path="/tesoreria" element={<RequireWallet><RequireOnboarding><Tesoreria /></RequireOnboarding></RequireWallet>} />
              <Route path="/notificaciones" element={<RequireWallet><RequireOnboarding><Notificaciones /></RequireOnboarding></RequireWallet>} />
              <Route path="/ayuda" element={<RequireWallet><RequireOnboarding><Ayuda /></RequireOnboarding></RequireWallet>} />
              
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </WalletSessionProvider>
        </BrowserRouter>
       </PrivyProvider>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
