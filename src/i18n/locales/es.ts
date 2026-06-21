/**
 * Spanish (es) — base locale
 * Key naming convention: <namespace>.<section>.<element>
 * Example: common.nav.home, login.errors.popup_blocked
 *
 * Rules:
 *  - Keys are snake_case, semantic, and stable (never change a key, only its value)
 *  - Interpolation uses {{variable}} syntax
 *  - Plurals use _one / _other suffix when needed
 */

const es = {
  // ─── Shared across the whole app ────────────────────────────────────────────
  common: {
    app_name: "Vyn",
    app_tagline: "Stellar Microcredits",
    loading: "Cargando...",
    error: "Error",
    close: "Cerrar",
    cancel: "Cancelar",
    confirm: "Confirmar",
    save: "Guardar",
    later: "Después",
    done: "Listo",
    retry: "Intentar de nuevo",
    back: "Volver",
    next: "Siguiente",
    skip: "Omitir",
    logout: "Cerrar sesión",
    wallet_connected: "Wallet conectada",
    wallet_not_connected: "Wallet no conectada",
    stellar_testnet: "Stellar Testnet",
    xlm: "XLM",
    footer_version: "Vyn v1.0 · Stellar Network",
    footer_protocol: "Protocolo Vyn · Descentralizado",
    footer_stellar: "Stellar Protocol · 2026",
    view_on_network: "Ver en red",
    receipt: "RECIBO",
    view_on_explorer: "Ver en el explorador",
  },

  // ─── Bottom navigation ───────────────────────────────────────────────────────
  nav: {
    home: "Inicio",
    withdrawals: "Retiros",
    history: "Historial",
    profile: "Perfil",
  },

  // ─── Login / Auth ────────────────────────────────────────────────────────────
  login: {
    title: "Vínculo",
    connect_freighter: "Conectar con Freighter",
    connect_albedo: "Conectar con Albedo",
    mobile_wallet_title: "Wallet móvil",
    mobile_wallet_description:
      "Usaremos Albedo, una wallet web de Stellar que funciona directamente en tu navegador — sin instalar nada.",
    freighter_not_detected_title: "Freighter no detectado",
    freighter_not_detected_description:
      "Para usar Vínculo en escritorio necesitas la extensión Freighter, o puedes conectarte con Albedo directamente.",
    errors: {
      cancelled: "Conexión cancelada. Puedes intentarlo de nuevo cuando quieras.",
      popup_blocked:
        "El popup fue bloqueado. Permite ventanas emergentes para este sitio e intenta de nuevo.",
      wallet_locked:
        "Tu wallet está bloqueada. Desbloquéala e intenta de nuevo.",
      no_network:
        "Sin conexión a la red. Verifica tu internet e intenta de nuevo.",
      generic:
        "Error de conexión. Verifica que tu wallet esté desbloqueada e intenta de nuevo.",
    },
  },

  // ─── Onboarding ──────────────────────────────────────────────────────────────
  onboarding: {
    cta_next: "Siguiente",
    cta_start: "¡Vamos allá!",
    cta_skip: "Omitir",
    steps: {
      save: {
        title: "Ahorra poquito a poquito 🐷",
        description:
          "Cada semana guardas una parte de lo que ganas. No importa si es poco — lo que cuenta es la constancia. ¡Tú puedes!",
      },
      reputation: {
        title: "Sube de nivel 🏆",
        description:
          "Con 3 depósitos seguidos alcanzas el Nivel Plata. Así demuestras que eres de fiar y te abres puertas a cosas increíbles.",
      },
      credit: {
        title: "¡Recibe tu crédito! 🎉",
        description:
          "Al llegar a Nivel Plata desbloqueas hasta 300 XLM de crédito. Sin papeleo, sin filas — directo a tu celular.",
      },
    },
  },

  // ─── Home / Index ────────────────────────────────────────────────────────────
  home: {
    deposit_button: "Depositar Ganancias",
    wallet_disconnected_title: "Wallet desconectada",
    wallet_disconnected_description:
      "Tu wallet no está disponible. Verifica que Freighter esté instalado y desbloqueado, o usa el botón de reconexión.",
    reconnect: "Reconectar",
    loading_wallet: "Cargando...",
  },

  // ─── Balance card ────────────────────────────────────────────────────────────
  balance: {
    label: "MI AHORRO",
    subtitle: "Saldo disponible en contrato",
    refresh_title: "Actualizar saldo",
  },

  // ─── Credit section ──────────────────────────────────────────────────────────
  credit: {
    title: "Crédito — Nivel {{tier}}",
    badge_onchain: "ON-CHAIN",
    locked_title: "Crédito Bloqueado 🔒",
    locked_description:
      "Tu nivel actual es {{tier}}. Reclama tu NFT para desbloquear.",
    debt_label: "Deuda Total a Pagar",
    expires_in: "Vence en: {{time}}",
    withdraw_button: "Retirar a mi Wallet",
    pay_button: "Pagar {{amount}} XLM",
    footer_network:
      "El retiro genera una transacción en la red Testnet de Stellar.",
    footer_interest:
      "Total a pagar al vencer (1 mes): {{amount}} XLM (Incluye 5% interés)",
    errors: {
      no_liquidity:
        "No hay liquidez suficiente en el pool para desembolsar este monto ahora. Intenta más tarde o retira un monto menor.",
      active_loan:
        "Ya tienes un préstamo activo. Debes pagarlo antes de solicitar uno nuevo.",
      tier_insufficient:
        "Tu NFT actual no habilita este crédito todavía. Actualiza tu nivel e intenta nuevamente.",
      cancelled: "Cancelaste la firma en Freighter. No se realizó el retiro.",
      generic:
        "No pudimos procesar el retiro ahora. Intenta nuevamente en unos segundos.",
    },
  },

  // ─── Deposit modal ───────────────────────────────────────────────────────────
  deposit: {
    title: "Depositar Ganancias",
    amount_label: "Monto (XLM)",
    confirm_button: "Confirmar con Freighter",
    signing_title: "Preparando contrato...",
    signing_description:
      "Calculando recursos y esperando confirmación en Freighter.",
    success_title: "¡Depósito exitoso! 🎉",
    success_description: "Se depositaron {{amount}} XLM",
    view_explorer: "Ver en el explorador",
  },

  // ─── Activity list ───────────────────────────────────────────────────────────
  activity: {
    header: "Actividad Reciente",
    empty_title_no_wallet: "Wallet no conectada",
    empty_title_no_activity: "Sin actividad aún",
    empty_description_no_wallet: "Conecta Freighter para ver tu historial",
    empty_description_no_activity: "Realiza tu primer depósito para comenzar",
    tx_deposit: "Depósito a Vínculo",
    tx_withdrawal: "Retiro de Crédito",
  },

  // ─── Wallet setup modal ──────────────────────────────────────────────────────
  wallet_setup: {
    title: "Conecta tu wallet",
    subtitle_albedo: "Vía Albedo (web wallet)",
    subtitle_freighter: "Vía Freighter",
    connect_albedo: "Conectar con Albedo (web)",
    connect_freighter: "Conectar con Freighter",
    freighter_not_detected: "Freighter no detectado",
    freighter_not_detected_description:
      "Instala la extensión o continúa con Albedo, una wallet web que no requiere instalación.",
    install_freighter_alt: "Instalar Freighter en su lugar",
    install_freighter_link: "¿No tienes Freighter? Descárgala aquí",
    error_cancelled: "Conexión cancelada. Puedes intentarlo de nuevo cuando quieras.",
    error_popup_blocked:
      "El popup fue bloqueado. Permite ventanas emergentes para este sitio e intenta de nuevo.",
    error_wallet_locked:
      "Tu wallet está bloqueada. Desbloquéala e intenta de nuevo.",
    error_no_network:
      "Sin conexión a la red. Verifica tu internet e intenta de nuevo.",
    error_generic:
      "Error de conexión. Verifica que tu wallet esté desbloqueada e intenta de nuevo.",
    error_save: "No se pudo guardar. Intenta de nuevo.",
  },

  // ─── History page ────────────────────────────────────────────────────────────
  history: {
    title: "Historial",
    subtitle: "Últimas 40 transacciones en Stellar",
    syncing: "Sincronizando blockchain...",
    empty_title_no_wallet: "Wallet no conectada",
    empty_title_no_txs: "Sin transacciones",
    empty_description_no_wallet: "Conecta Freighter para ver tu historial",
    empty_description_no_txs: "Tus depósitos y retiros aparecerán aquí",
    tx_deposit: "Depósito a Vínculo",
    tx_withdrawal: "Retiro de Crédito",
    summary_title: "Resumen del Periodo",
    summary_deposits: "Depósitos",
    summary_volume_in: "Volumen Ingresado",
    summary_withdrawals: "Retiros",
    summary_volume_out: "Volumen Retirado",
  },

  // ─── Profile page ────────────────────────────────────────────────────────────
  profile: {
    title: "Perfil",
    stat_savings: "XLM Ahorro",
    stat_credit: "Crédito XLM",
    stat_nft_level: "Nivel NFT",
    reputation_label: "Reputación Vínculo",
    reputation_unlocked: "✓ LÍMITE AUMENTADO",
    reputation_locked: "Requiere Nivel Plata",
    reputation_max: "Nivel máximo alcanzado",
    reputation_progress: "{{percent}}% al sig. nivel",
    reputation_activity_gate:
      "Mantén tu actividad para desbloquear reputación ({{current}}/{{required}})",
    mint_button_default: "Evaluar y Subir de Nivel (NFT)",
    mint_button_signing: "Firmando en Soroban...",
    mint_button_no_wallet: "Conecta tu wallet para mintear",
    mint_button_no_balance: "Deposita XLM para evaluar",
    mint_button_max_tier: "Nivel maximo alcanzado",
    mint_button_already_has:
      "Ya tienes {{tier}}. Espera al siguiente nivel",
    max_tier_badge: "Nivel Máximo Alcanzado 💎",
    wallet_address_label: "Dirección Stellar",
    menu_notifications: "Notificaciones",
    menu_notifications_detail: "Activadas",
    menu_help: "Centro de ayuda",
    menu_logout: "Cerrar sesión",
    toast_minted_title: "NFT minteado con exito",
    toast_minted_description: "Subiste a nivel {{level}}.",
    toast_error_connection_title: "Conexion inestable",
    toast_error_connection_description:
      "No pudimos conectar con la red de Stellar. Intenta nuevamente en unos segundos.",
    mint_feedback: {
      insufficient_level_title: "Aun no alcanzas el siguiente nivel",
      insufficient_level_description: "Sigue ahorrando y vuelve a intentar.",
      already_minted_title: "Nivel ya minteado",
      already_minted_description:
        "Ya tienes el NFT {{level}}. Sube tu reputacion para mintear el siguiente nivel.",
      generic_title: "No se pudo mintear",
      generic_description:
        "No pudimos mintear tu NFT en este momento. Intentalo nuevamente en unos segundos.",
    },
  },

  // ─── Withdrawals / Retiros page ──────────────────────────────────────────────
  withdrawals: {
    title: "Retiros",
    subtitle: "Envía fondos a tu wallet",
    available_balance: "Saldo disponible",
    withdraw_button: "Retirar",
    staking_section_title: "Staking",
    staking_card_title: "Generar rendimientos",
    staking_card_description: "Bloquea tus fondos y gana intereses",
    staking_empty_title: "Sin posiciones de staking",
    staking_empty_description:
      "Elige un plazo arriba para empezar a generar rendimientos",
    staking_active_label: "Posición Activa",
    staking_locked_label: "Bloqueado a {{months}} mes(es)",
    staking_apy_label: "{{apy}}% APY Generado",
    staking_earnings_label: "Ganancia",
    staking_ready: "¡Listo para retirar!",
    staking_time_left: "{{minutes}}m {{seconds}}s restantes",
    unstake_button: "Retirar Inversión",
    modal_withdraw_title: "Retirar fondos",
    modal_withdraw_subtitle: "Indica la cantidad que deseas enviar a tu wallet",
    modal_confirm_button: "Confirmar Retiro",
    modal_all_button: "TODO",
    modal_signing: "Procesando...",
    modal_success_title: "Retiro Exitoso",
    modal_staking_title: "Staking",
    modal_staking_confirm: "Bloquear Fondos",
    modal_staking_signing: "Procesando en Soroban...",
    modal_staking_signing_sub: "Confirma en Freighter",
    modal_staking_success: "¡Transacción Exitosa!",
    error_insufficient: "Saldo insuficiente",
  },

  // ─── Notifications page ──────────────────────────────────────────────────────
  notifications: {
    title: "Notificaciones",
    subtitle_unread: "{{count}} nuevas hoy",
    mark_all_read: "Marcar todas como leídas",
    empty_title: "Bandeja vacía",
    empty_description:
      "No tienes novedades por ahora. ¡Te avisaremos ante cualquier cambio!",
    confirm_clear_all: "¿Borrar todas las notificaciones?",
    mock_deposit_title: "Depósito confirmado",
    mock_deposit_message:
      "Tus 50 XLM ya están en el contrato inteligente generando reputación.",
    mock_deposit_time: "Hace 2 horas",
    mock_tier_title: "¡Nivel Plata disponible! 🥈",
    mock_tier_message:
      "Tu puntaje superó los 50 pts. Ya puedes reclamar tu NFT de Nivel Plata.",
    mock_tier_time: "Hace 1 día",
    mock_welcome_title: "Bienvenido a Vyn",
    mock_welcome_message:
      "Conecta tu Freighter para empezar a construir tu historial financiero.",
    mock_welcome_time: "Hace 3 días",
  },

  // ─── Help / Ayuda page ───────────────────────────────────────────────────────
  help: {
    title: "Centro de Ayuda",
    support_title: "¿Tienes dudas técnicas?",
    support_description:
      "Si tienes problemas con Freighter o con tus transacciones, escríbenos.",
    faq_section_label: "Preguntas Frecuentes",
    resources_section_label: "Recursos de la Red",
    stellar_expert_title: "Stellar Expert",
    stellar_expert_subtitle: "Explorador de la Testnet",
    freighter_title: "Freighter Wallet",
    freighter_subtitle: "Centro de ayuda oficial",
    faqs: [
      {
        q: "¿Qué es Vyn?",
        a: "Vyn (Vínculo) es una plataforma DeFi que construye tu identidad financiera en la blockchain. Al ahorrar en nuestro contrato inteligente, generas un puntaje de reputación que te permite acceder a microcréditos sin burocracia tradicional.",
      },
      {
        q: "¿Cómo subo de nivel?",
        a: "Tu nivel (Bronce, Plata, Oro...) depende de tu Puntaje de Reputación. Este se calcula mediante un algoritmo que premia la constancia de tus depósitos y el tiempo que mantienes tus fondos en el contrato. A mayor puntaje, mayor límite de crédito.",
      },
      {
        q: "¿Qué son los niveles NFT?",
        a: "Cada nivel es un Soulbound Token (SBT). Es un NFT especial vinculado a tu wallet que no se puede transferir ni vender. Es tu 'medalla' de buen pagador y ahorrador en la red Stellar.",
      },
      {
        q: "¿En qué red opera Vyn?",
        a: "Actualmente operamos en Stellar Testnet (Red de Pruebas). Esto permite que pruebes todas las funcionalidades sin usar dinero real mientras terminamos la fase de auditoría.",
      },
      {
        q: "¿Cómo retiro mi crédito?",
        a: "Una vez alcances el Nivel Plata (50 pts de reputación), la opción de 'Retirar Crédito' se habilitará automáticamente en tu perfil. El monto se enviará directo a tu wallet Freighter.",
      },
      {
        q: "¿Mis fondos están seguros?",
        a: "Absolutamente. Vyn utiliza Smart Contracts en Soroban (Stellar). Los fondos están bloqueados bajo reglas criptográficas que solo tú controlas con tu firma digital en Freighter.",
      },
    ],
  },

  // ─── NFT Modal ───────────────────────────────────────────────────────────────
  nft_modal: {
    badge: "NFT Acreditado",
    title: "¡Felicidades!",
    subtitle:
      "Tu NFT de reputación ha sido minteado exitosamente en la red Stellar.",
    meta_level: "Nivel Alcanzado",
    meta_deposits: "Historial de Depósitos",
    meta_volume: "Volumen Protegido",
    meta_owner: "Propietario",
    explorer_link: "Ver en StellarExpert",
    accept_button: "Aceptar y Continuar",
    nft_alt: "NFT Nivel {{level}}",
  },

  // ─── 404 ─────────────────────────────────────────────────────────────────────
  not_found: {
    title: "404",
    message: "Oops! Page not found",
    return_home: "Return to Home",
  },
} as const;

export default es;
export type TranslationKeys = typeof es;
