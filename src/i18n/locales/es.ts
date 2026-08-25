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
    copy: "Copiar",
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
    usdc: "USDC",
    footer_version: "Vyn v1.0 · Stellar Network",
    footer_protocol: "Protocolo Vyn · Descentralizado",
    footer_stellar: "Stellar Protocol · 2026",
    view_on_network: "Ver en red",
    receipt: "RECIBO",
    view_on_explorer: "Ver en el explorador",
  },

  // ─── Depositar por SPEI (on-ramp Accesly) ────────────────────────────────────
  deposit_spei: {
    title: "Depositar por SPEI",
    subtitle: "Transfiere pesos y recibe USDC en tu cuenta",
    amount_label: "¿Cuánto quieres depositar?",
    quote_rate: "Tipo de cambio",
    quote_fee: "Comisión",
    quote_receive: "Recibirás",
    generate_cta: "Generar CLABE de depósito",
    generating: "Generando tu CLABE…",
    clabe_label: "CLABE para tu depósito SPEI",
    clabe_single_use: "CLABE de un solo uso para este depósito. Transfiere el monto exacto desde tu banco.",
    copied: "Copiada",
    you_send: "Tú envías",
    waiting_payment: "Esperando la confirmación de tu transferencia…",
    simulate_cta: "Simular envío SPEI",
    simulate_hint: "Solo demo (sandbox): acredita el depósito sin esperar al banco.",
    settling: "Acreditando tus fondos…",
    settling_hint: "Convertimos tu pago a USDC y lo movemos a tu cuenta de ahorro.",
    success_title: "¡Depósito confirmado!",
    success_desc: "Acreditaremos {{usd}} USDC a tu cuenta en unos momentos.",
    success_vault_desc: "{{usd}} USDC se depositaron en tu cuenta de ahorro.",
    success_wallet_desc: "{{usd}} USDC se acreditaron a tu wallet. Puedes depositarlos a tu ahorro cuando quieras.",
    go_home: "Ir al inicio",
    accesly_hint: "Este depósito funciona con tu cuenta de correo o con tu wallet conectada.",
    min_hint: "Mínimo: $10 USD (≈ 175 MXN). Ingresas pesos; verás cuántos USDC recibes.",
    min_error: "El monto mínimo es $10 USD (≈ 175 MXN).",
    no_wallet: "No encontramos tu cuenta. Vuelve a iniciar sesión.",
    generic_error: "No pudimos generar el depósito. Intenta de nuevo.",
    quote_error: "No pudimos cotizar el depósito. Intenta de nuevo en un momento.",
  },

  // ─── Bottom navigation ───────────────────────────────────────────────────────
  nav: {
    home: "Inicio",
    withdrawals: "Retiros",
    history: "Historial",
    profile: "Perfil",
    treasury: "Tesorería",
  },

  // ─── App shell (sidebar / header) ────────────────────────────────────────────
  shell: {
    wallet_mismatch_title: "Cambiaste de cuenta en Freighter",
    wallet_mismatch_description:
      "Tu sesión es con {{expected}} pero Freighter está en {{active}}. Vuelve a {{expected}} en la extensión para continuar tu sesión.",
  },

  // ─── Login / Auth ────────────────────────────────────────────────────────────
  login: {
    title: "Vínculo",
    accesly_cta: "Entrar con correo",
    accesly_creating: "Creando tu cuenta…",
    accesly_hint: "Con Google o Apple. Sin frase semilla, sin gas.",
    accesly_popup_hint: "Completa el inicio de sesión en la ventana que apareció.",
    or_divider: "o",
    connect_wallet: "Conectar wallet",
    wallet_picker_title: "Elige tu wallet de Stellar",
    wallet_picker_description:
      "Conéctate con Freighter, Albedo, xBull, Lobstr, Hana o Rabet. Elegirás tu wallet en la siguiente ventana.",
    errors: {
      cancelled: "Conexión cancelada. Puedes intentarlo de nuevo cuando quieras.",
      popup_blocked:
        "El popup fue bloqueado. Permite ventanas emergentes para este sitio e intenta de nuevo.",
      wallet_locked:
        "Tu wallet está bloqueada. Desbloquéala e intenta de nuevo.",
      wallet_missing:
        "Wallet no disponible o no instalada. Conecta tu wallet para continuar.",
      session_expired:
        "Tu sesión de wallet ha expirado o es inválida. Por favor reconecta tu wallet.",
      no_network:
        "Sin conexión a la red. Verifica tu internet e intenta de nuevo.",
      generic:
        "Error de conexión. Verifica que tu wallet esté desbloqueada e intenta de nuevo.",
    },
  },

  // ─── Errores de Wallet Estandarizados ───────────────────────────────────────
  wallet_errors: {
    cancelled: "Operación cancelada. Puedes intentarlo de nuevo cuando quieras.",
    popup_blocked: "El popup fue bloqueado. Permite ventanas emergentes para este sitio e intenta de nuevo.",
    wallet_locked: "Tu wallet está bloqueada. Desbloquéala en la extensión e intenta de nuevo.",
    wallet_missing: "Wallet no disponible o no instalada. Conecta tu wallet para continuar.",
    session_expired: "Tu sesión ha expirado o es inválida. Por favor reconecta tu wallet.",
    account_mismatch: "Cuenta incorrecta. Por favor cambia a la cuenta {{expected}} en tu wallet.",
    account_not_found: "La cuenta no existe en la red Stellar. Asegúrate de que esté fondeada con XLM.",
    insufficient_balance: "Saldo insuficiente para cubrir la transacción y las comisiones de red.",
    insufficient_usdc: "Saldo USDC insuficiente. Tienes {{balance}} USDC disponibles.",
    no_liquidity: "No hay liquidez suficiente en el pool en este momento. Intenta más tarde o con un monto menor.",
    active_loan: "Ya tienes un préstamo activo. Debes pagarlo antes de solicitar uno nuevo.",
    tier_insufficient: "Tu nivel actual no habilita este crédito todavía. Sube de nivel e intenta de nuevo.",
    network_error: "Sin conexión a la red. Verifica tu internet e intenta de nuevo.",
    contract_error: "Error al ejecutar el contrato inteligente. Intenta de nuevo.",
    generic: "Error al procesar la operación con la wallet. Intenta de nuevo.",
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
    welcome_title: "¡Bienvenido de nuevo!",
    dashboard_subtitle: "Resumen de tu actividad en Stellar",
    nft_card_title: "Nivel NFT",
    nft_rank_label: "Rango actual",
    nft_next_level: "Siguiente nivel: {{level}}",
    nft_max_level: "Nivel máximo alcanzado",
    ring_no_wallet_title: "Reputación Vínculo",
    ring_no_wallet_desc: "Conecta tu wallet para ver tu nivel",
    ring_locked_short: "Bloq",
    ring_reputation_label: "Reputación",
    ring_path_to_level: "Camino al Nivel {{level}} {{emoji}}",
    ring_max_level_named: "¡Nivel {{level}} Máximo! {{emoji}}",
    ring_locked_desc: "Sigue usando Vyn para desbloquear tu reputación",
    ring_trust_score: "Trust Score: <b>{{score}} pts</b>",
    ring_history: "Historial: <b>{{count}}/{{min}} transacciones</b>",
    ring_claim_nft: "Reclamar NFT {{level}} disponible",
    yield_title: "Rendimiento real",
    yield_subtitle: "Yield generado en el vault DeFindex",
    period_title: "Resumen del periodo",
    period_deposits: "Depósitos",
    period_withdrawals: "Retiros",
    period_volume_in: "Vol. ingresado",
    period_volume_out: "Vol. retirado",
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
    syncing: "Sincronizando con Soroban...",
    locked_title: "Crédito Bloqueado 🔒",
    locked_description:
      "Tu nivel actual es {{tier}}. Reclama tu NFT para desbloquear.",
    anomaly:
      "Score anómalo detectado. Los datos serán revisados antes de habilitar operaciones.",
    debt_label: "Deuda Total a Pagar",
    expires_in: "Vence en: {{time}}",
    limit_label: "Límite de crédito disponible según tu SBT",
    withdraw_button: "Retirar a mi Wallet",
    pay_button: "Pagar {{amount}} XLM",
    authorizing: "Autorizando...",
    processing: "Procesando...",
    frozen_title: "¡CUENTA CONGELADA!",
    frozen_description: "Tu plazo de pago ha expirado. Deuda pendiente:",
    contact_support: "Contactar a Soporte",
    footer_network:
      "El retiro genera una transacción en la red Testnet de Stellar.",
    footer_interest:
      "Total a pagar al vencer (1 mes): {{amount}} XLM (Incluye 5% interés)",
    tiers: {
      "0": "Bronce",
      "1": "Plata",
      "2": "Oro",
      "3": "Diamante",
      "4": "Platino",
    },
    errors: {
      no_liquidity:
        "No hay liquidez suficiente en el pool para desembolsar este monto ahora. Intenta más tarde o retira un monto menor.",
      active_loan:
        "Ya tienes un préstamo activo. Debes pagarlo antes de solicitar uno nuevo.",
      tier_insufficient:
        "Tu NFT actual no habilita este crédito todavía. Actualiza tu nivel e intenta nuevamente.",
      cancelled: "Cancelaste la firma. No se realizó el retiro.",
      generic:
        "No pudimos procesar el retiro ahora. Intenta nuevamente en unos segundos.",
      connect_wallet: "Debes conectar tu billetera primero",
      wrong_account: "Cuenta incorrecta. Cambia en Freighter a: {{wallet}}",
      repay_generic: "No se pudo realizar el pago. Revisa tus fondos.",
    },
  },

  // ─── Deposit modal ───────────────────────────────────────────────────────────
  deposit: {
    method_title: "Depositar",
    method_subtitle: "Elige cómo quieres agregar fondos.",
    method_wallet_title: "Con wallet",
    method_wallet_desc: "Deposita USDC directo desde tu wallet.",
    method_spei_title: "Por SPEI",
    method_spei_desc: "Paga en pesos por transferencia bancaria.",
    title: "Depositar Ganancias",
    amount_label: "Monto (USDC)",
    confirm_button: "Firmar transacción",
    signing_title: "Preparando contrato...",
    signing_description:
      "Calculando recursos y esperando tu firma.",
    success_title: "¡Depósito exitoso! 🎉",
    success_description: "Se depositaron {{amount}} USDC",
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
    tx_savings_withdraw: "Retiro de ahorro",
    tx_loan: "Préstamo recibido",
    tx_repay: "Pago de préstamo",
    tx_mint: "SBT Nivel {{level}}",
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
    tab_all: "Todas",
    tab_deposits: "Depósitos",
    tab_withdrawals: "Retiros",
    tab_loans: "Préstamos",
    search_placeholder: "Buscar por tipo, monto o dirección...",
    empty_filtered_title: "Sin resultados",
    empty_filtered_description: "No hay transacciones que coincidan con este filtro.",
    types_title: "Tipos de transacciones",
    types_total: "Total",
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
    subtitle: "Gestiona tu cuenta y preferencias",
    limits_title: "Límites y nivel",
    limit_daily: "Límite diario de retiro",
    limit_monthly: "Límite mensual de retiro",
    stat_savings: "USDC Ahorro",
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
    mint_button_no_balance: "Deposita USDC para evaluar",
    mint_button_max_tier: "Nivel maximo alcanzado",
    mint_button_already_has:
      "Ya tienes {{tier}}. Espera al siguiente nivel",
    max_tier_badge: "Nivel Máximo Alcanzado 💎",
    wallet_address_label: "Dirección Stellar",
    wallet_panel_title: "Tu wallet",
    wallet_panel_desc: "Abre tu wallet para ver tus saldos y movimientos.",
    open_wallet: "Abrir wallet",
    open_wallet_hint: "Abre tu extensión de wallet (Freighter) para ver tus saldos.",
    activate_usdc: "Activar USDC",
    usdc_active_label: "USDC activado ✓",
    usdc_ready_title: "USDC ya activado",
    usdc_ready_desc: "Tu wallet ya puede recibir y depositar USDC.",
    usdc_activated_title: "¡USDC activado!",
    usdc_activated_desc: "Tu wallet ya puede recibir y depositar USDC.",
    usdc_retry_faucet: "Reintentar USDC",
    usdc_faucet_failed_title: "USDC de prueba no enviado",
    usdc_faucet_failed_desc: "La trustline quedó activa, pero el USDC de prueba no se pudo enviar. Inténtalo de nuevo en unos segundos.",
    usdc_faucet_no_trustline: "Aún no se ve tu trustline en la red. Espera unos segundos y vuelve a intentar.",
    usdc_already_claimed_title: "USDC de prueba ya reclamado",
    usdc_already_claimed_desc: "Esta wallet ya recibió el USDC de prueba.",
    usdc_account_not_funded: "Tu cuenta aún no existe en la red (sin XLM). Inténtalo de nuevo en unos segundos; si persiste, fondéala con XLM de testnet.",
    usdc_popup_blocked: "Tu navegador bloqueó la ventana de Albedo. Permite las ventanas emergentes para este sitio y vuelve a pulsar Activar USDC.",
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
    limit_label: "Límite de retiro (diario)",
    limit_increase: "Aumentar límite",
    limit_soon: "Próximamente",
    yield_card_title: "Rendimiento real",
    yield_card_description: "Tu apartado genera yield en el vault DeFindex",
    yield_label: "Generado",
    method_step_title: "1. Selecciona el método de retiro",
    method_usdc_title: "USDC",
    method_usdc_desc: "Red Stellar",
    method_spei_title: "SPEI / Transferencia MXN",
    method_spei_desc: "A cuenta bancaria mexicana",
    method_moneygram_title: "MoneyGram",
    method_moneygram_desc: "Efectivo en locales",
    coming_soon: "Próximamente",
    roadmap_note: "El retiro a pesos (MXN) vía SPEI y MoneyGram en efectivo llegará pronto.",
    info_title: "Información sobre retiros",
    info_processing_title: "Tiempo de procesamiento",
    info_processing_desc: "Usualmente de 5 a 15 minutos",
    info_network_title: "Red utilizada",
    info_network_desc: "Stellar Network (Testnet)",
    modal_withdraw_title: "Retirar fondos",
    modal_withdraw_subtitle: "Indica la cantidad que deseas enviar a tu wallet",
    modal_address_label: "Dirección de destino (Stellar)",
    modal_address_use_current: "Usar billetera actual",
    modal_address_note: "El retiro se procesa hacia tu wallet conectada.",
    modal_network_fee_note: "La tarifa de red se mostrará al firmar la transacción.",
    saved_addr_title: "Direcciones guardadas",
    saved_addr_soon: "Próximamente…",
    saved_addr_empty: "Guarda direcciones frecuentes para retiros más rápidos.",
    modal_confirm_button: "Confirmar Retiro",
    modal_all_button: "TODO",
    modal_signing: "Procesando...",
    modal_success_title: "Retiro Exitoso",
    modal_error_title: "No se pudo completar",
    error_insufficient: "Saldo insuficiente",
    min_hint_wallet: "Mínimo: 1 USDC ($1 USD)",
    min_wallet_error: "El monto mínimo es 1 USDC ($1 USD)",
    spei: {
      kyc_title: "Verificación de identidad",
      kyc_desc: "Para retirar a una cuenta bancaria mexicana necesitas verificar tu identidad (KYC) una sola vez.",
      kyc_button: "Simular KYC",
      kyc_done: "Identidad verificada",
      demo_note: "Modo demo: se usa una cuenta SPEI de prueba (sandbox).",
      clabe_label: "CLABE destino",
      clabe_locked_label: "CLABE destino (predefinida)",
      modal_title: "Retirar a SPEI",
      modal_subtitle: "Tu saldo se retira y te llega en pesos a tu cuenta",
      min_hint: "Mínimo: 10 USDC ($10 USD). Ingresas USDC; abajo ves cuántos pesos recibes.",
      quote_receive: "Recibirás",
      quote_rate: "Tipo de cambio",
      quote_fee: "Comisión",
      quote_blindpay_fee: "Comisión BlindPay",
      quote_platform_fee: "Comisión de plataforma",
      quote_total_receive: "Total a recibir",
      quote_loading: "Calculando...",
      kyc_verifying: "Verificando identidad…",
      kyc_completed: "Verificación completada",
      confirm_button: "Retirar a SPEI",
      signing_withdraw: "Firma el retiro de tu saldo en tu wallet...",
      sending: "Enviando tu dinero por SPEI...",
      success_title: "¡SPEI enviado!",
      success_desc: "{{mxn}} MXN en camino a tu cuenta bancaria.",
      success_eta: "Llega en minutos · vía {{provider}}",
      error_title: "No se pudo enviar el SPEI",
      min_error: "El monto mínimo es 10 USDC (BlindPay exige ≥ $10 USD por SPEI)",
    },
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
      "Tus 50 USDC ya están en el contrato inteligente generando reputación.",
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
    fallback_level: "Nivel {{level}}",
    fallback_brand: "Vin · Stellar",
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
