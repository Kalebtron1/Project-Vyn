import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Botón de cambio de tema (claro/oscuro) basado en next-themes. */
const ThemeToggle = ({ className = "" }: { className?: string }) => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Evita el mismatch de hidratación: el tema real solo se conoce en cliente.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title="Cambiar tema"
      aria-label="Cambiar tema"
      className={`flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors active:scale-95 ${className}`}
    >
      {mounted && isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};

export default ThemeToggle;
