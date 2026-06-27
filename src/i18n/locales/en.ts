/**
 * English (en) locale
 * Mirrors the shape of es.ts exactly — add/remove keys in both files together.
 */

const en = {
  common: {
    app_name: "Vyn",
    app_tagline: "Stellar Microcredits",
    loading: "Loading...",
    error: "Error",
    close: "Close",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    later: "Later",
    done: "Done",
    retry: "Try again",
    back: "Back",
    next: "Next",
    skip: "Skip",
    logout: "Log out",
    wallet_connected: "Wallet connected",
    wallet_not_connected: "Wallet not connected",
    stellar_testnet: "Stellar Testnet",
    xlm: "XLM",
    usdc: "USDC",
    footer_version: "Vyn v1.0 · Stellar Network",
    footer_protocol: "Vyn Protocol · Decentralized",
    footer_stellar: "Stellar Protocol · 2026",
    view_on_network: "View on network",
    receipt: "RECEIPT",
    view_on_explorer: "View on explorer",
  },

  nav: {
    home: "Home",
    withdrawals: "Withdrawals",
    history: "History",
    profile: "Profile",
    treasury: "Treasury",
  },

  shell: {
    promo_title: "Increase your limits",
    promo_description: "Deposit USDC to level up and increase your limits.",
    promo_cta: "Deposit now",
  },

  login: {
    title: "Vínculo",
    connect_freighter: "Connect with Freighter",
    connect_albedo: "Connect with Albedo",
    mobile_wallet_title: "Mobile wallet",
    mobile_wallet_description:
      "We'll use Albedo, a Stellar web wallet that works directly in your browser — no installation needed.",
    freighter_not_detected_title: "Freighter not detected",
    freighter_not_detected_description:
      "To use Vínculo on desktop you need the Freighter extension, or you can connect with Albedo directly.",
    errors: {
      cancelled: "Connection cancelled. You can try again whenever you're ready.",
      popup_blocked:
        "The popup was blocked. Allow pop-ups for this site and try again.",
      wallet_locked:
        "Your wallet is locked. Unlock it and try again.",
      no_network:
        "No network connection. Check your internet and try again.",
      generic:
        "Connection error. Make sure your wallet is unlocked and try again.",
    },
  },

  onboarding: {
    cta_next: "Next",
    cta_start: "Let's go!",
    cta_skip: "Skip",
    steps: {
      save: {
        title: "Save little by little 🐷",
        description:
          "Every week you set aside a portion of what you earn. It doesn't matter how small — consistency is what counts. You've got this!",
      },
      reputation: {
        title: "Level up 🏆",
        description:
          "With 3 consecutive deposits you reach Silver Level. That proves you're reliable and opens doors to incredible things.",
      },
      credit: {
        title: "Get your credit! 🎉",
        description:
          "Reaching Silver Level unlocks up to 300 XLM in credit. No paperwork, no queues — straight to your phone.",
      },
    },
  },

  home: {
    deposit_button: "Deposit Earnings",
    wallet_disconnected_title: "Wallet disconnected",
    wallet_disconnected_description:
      "Freighter is not available. Reconnect your wallet to operate.",
    reconnect: "Reconnect",
    loading_wallet: "Loading...",
    welcome_title: "Welcome back!",
    dashboard_subtitle: "Summary of your activity on Stellar",
    nft_card_title: "NFT Level",
    nft_rank_label: "Current rank",
    nft_next_level: "Next level: {{level}}",
    nft_max_level: "Maximum level reached",
    yield_title: "Real yield",
    yield_subtitle: "Yield earned in the DeFindex vault",
    period_title: "Period summary",
    period_deposits: "Deposits",
    period_withdrawals: "Withdrawals",
    period_volume_in: "Vol. in",
    period_volume_out: "Vol. out",
  },

  balance: {
    label: "MY SAVINGS",
    subtitle: "Available balance in contract",
    refresh_title: "Refresh balance",
  },

  credit: {
    title: "Credit — {{tier}} Level",
    badge_onchain: "ON-CHAIN",
    locked_title: "Credit Locked 🔒",
    locked_description:
      "Your current level is {{tier}}. Claim your NFT to unlock.",
    debt_label: "Total Debt to Pay",
    expires_in: "Expires in: {{time}}",
    withdraw_button: "Withdraw to my Wallet",
    pay_button: "Pay {{amount}} XLM",
    footer_network:
      "The withdrawal creates a transaction on the Stellar Testnet.",
    footer_interest:
      "Total due at maturity (1 month): {{amount}} XLM (Includes 5% interest)",
    errors: {
      no_liquidity:
        "There is not enough liquidity in the pool to disburse this amount right now. Try later or withdraw a smaller amount.",
      active_loan:
        "You already have an active loan. You must pay it off before requesting a new one.",
      tier_insufficient:
        "Your current NFT does not enable this credit yet. Upgrade your level and try again.",
      cancelled: "You cancelled the signature in Freighter. No withdrawal was made.",
      generic:
        "We couldn't process the withdrawal right now. Try again in a few seconds.",
    },
  },

  deposit: {
    title: "Deposit Earnings",
    amount_label: "Amount (USDC)",
    confirm_button: "Confirm with Freighter",
    signing_title: "Preparing contract...",
    signing_description:
      "Calculating resources and waiting for confirmation in Freighter.",
    success_title: "Deposit successful! 🎉",
    success_description: "{{amount}} USDC deposited",
    view_explorer: "View on explorer",
  },

  activity: {
    header: "Recent Activity",
    empty_title_no_wallet: "Wallet not connected",
    empty_title_no_activity: "No activity yet",
    empty_description_no_wallet: "Connect Freighter to see your history",
    empty_description_no_activity: "Make your first deposit to get started",
    tx_deposit: "Deposit to Vínculo",
    tx_savings_withdraw: "Savings withdrawal",
    tx_loan: "Loan received",
    tx_repay: "Loan repayment",
    tx_mint: "SBT {{level}} Level",
    tx_withdrawal: "Credit Withdrawal",
  },

  wallet_setup: {
    title: "Connect your wallet",
    subtitle_albedo: "Via Albedo (web wallet)",
    subtitle_freighter: "Via Freighter",
    connect_albedo: "Connect with Albedo (web)",
    connect_freighter: "Connect with Freighter",
    freighter_not_detected: "Freighter not detected",
    freighter_not_detected_description:
      "Install the extension or continue with Albedo...",
    error_cancelled: "Connection cancelled. You can try again.",
    error_save: "Could not save. Try again.",
  },

  history: {
    title: "History",
    subtitle: "Last 40 transactions on Stellar",
    syncing: "Syncing blockchain...",
    tab_all: "All",
    tab_deposits: "Deposits",
    tab_withdrawals: "Withdrawals",
    tab_loans: "Loans",
    search_placeholder: "Search by type, amount or address...",
    empty_filtered_title: "No results",
    empty_filtered_description: "No transactions match this filter.",
    types_title: "Transaction types",
    types_total: "Total",
    empty_title_no_wallet: "Wallet not connected",
    empty_title_no_txs: "No transactions",
    empty_description_no_wallet: "Connect Freighter to see your history",
    empty_description_no_txs: "Your deposits and withdrawals will appear here",
    tx_deposit: "Deposit to Vínculo",
    tx_withdrawal: "Credit Withdrawal",
    summary_title: "Period Summary",
    summary_deposits: "Deposits",
    summary_volume_in: "Volume In",
    summary_withdrawals: "Withdrawals",
    summary_volume_out: "Volume Out",
  },

  profile: {
    title: "Profile",
    subtitle: "Manage your account and preferences",
    limits_title: "Limits and level",
    limit_daily: "Daily withdrawal limit",
    limit_monthly: "Monthly withdrawal limit",
    stat_savings: "USDC Savings",
    stat_credit: "Credit XLM",
    stat_nft_level: "NFT Level",
    reputation_label: "Vínculo Reputation",
    reputation_unlocked: "✓ LIMIT INCREASED",
    reputation_locked: "Requires Silver Level",
    reputation_max: "Maximum level reached",
    reputation_progress: "{{percent}}% to next level",
    reputation_activity_gate:
      "Keep your activity to unlock reputation ({{current}}/{{required}})",
    mint_button_default: "Evaluate and Level Up (NFT)",
    mint_button_signing: "Signing on Soroban...",
    mint_button_no_wallet: "Connect your wallet to mint",
    mint_button_no_balance: "Deposit USDC to evaluate",
    mint_button_max_tier: "Maximum level reached",
    mint_button_already_has:
      "You already have {{tier}}. Wait for the next level",
    max_tier_badge: "Maximum Level Reached 💎",
    wallet_address_label: "Stellar Address",
    menu_notifications: "Notifications",
    menu_notifications_detail: "Enabled",
    menu_help: "Help center",
    menu_logout: "Log out",
    toast_minted_title: "NFT minted successfully",
    toast_minted_description: "You leveled up to {{level}}.",
    toast_error_connection_title: "Unstable connection",
    toast_error_connection_description:
      "We couldn't connect to the Stellar network. Try again in a few seconds.",
    mint_feedback: {
      insufficient_level_title: "You haven't reached the next level yet",
      insufficient_level_description: "Keep saving and try again.",
      already_minted_title: "Level already minted",
      already_minted_description:
        "You already have the {{level}} NFT. Increase your reputation to mint the next level.",
      generic_title: "Could not mint",
      generic_description:
        "We couldn't mint your NFT right now. Try again in a few seconds.",
    },
  },

  withdrawals: {
    title: "Withdrawals",
    subtitle: "Send funds to your wallet",
    available_balance: "Available balance",
    withdraw_button: "Withdraw",
    yield_card_title: "Real yield",
    yield_card_description: "Your savings earn yield in the DeFindex vault",
    yield_label: "Earned",
    method_step_title: "1. Choose the withdrawal method",
    method_usdc_title: "USDC",
    method_usdc_desc: "Stellar Network",
    method_spei_title: "SPEI / MXN Transfer",
    method_spei_desc: "To a Mexican bank account",
    method_moneygram_title: "MoneyGram",
    method_moneygram_desc: "Cash at local agents",
    coming_soon: "Coming soon",
    roadmap_note: "Withdrawals to Mexican pesos (MXN) via SPEI and MoneyGram cash are coming soon.",
    info_title: "About withdrawals",
    info_processing_title: "Processing time",
    info_processing_desc: "Usually 5 to 15 minutes",
    info_network_title: "Network used",
    info_network_desc: "Stellar Network (Testnet)",
    modal_withdraw_title: "Withdraw funds",
    modal_withdraw_subtitle: "Enter the amount you want to send to your wallet",
    modal_confirm_button: "Confirm Withdrawal",
    modal_all_button: "ALL",
    modal_signing: "Processing...",
    modal_success_title: "Withdrawal Successful",
    modal_error_title: "Couldn't complete",
    error_insufficient: "Insufficient balance",
  },

  notifications: {
    title: "Notifications",
    subtitle_unread: "{{count}} new today",
    mark_all_read: "Mark all as read",
    empty_title: "Empty inbox",
    empty_description:
      "No news for now. We'll notify you of any changes!",
    confirm_clear_all: "Delete all notifications?",
    mock_deposit_title: "Deposit confirmed",
    mock_deposit_message:
      "Your 50 USDC are already in the smart contract building reputation.",
    mock_deposit_time: "2 hours ago",
    mock_tier_title: "Silver Level available! 🥈",
    mock_tier_message:
      "Your score exceeded 50 pts. You can now claim your Silver Level NFT.",
    mock_tier_time: "1 day ago",
    mock_welcome_title: "Welcome to Vyn",
    mock_welcome_message:
      "Connect your Freighter to start building your financial history.",
    mock_welcome_time: "3 days ago",
  },

  help: {
    title: "Help Center",
    support_title: "Have technical questions?",
    support_description:
      "If you have issues with Freighter or your transactions, write to us.",
    faq_section_label: "Frequently Asked Questions",
    resources_section_label: "Network Resources",
    stellar_expert_title: "Stellar Expert",
    stellar_expert_subtitle: "Testnet Explorer",
    freighter_title: "Freighter Wallet",
    freighter_subtitle: "Official help center",
    faqs: [
      {
        q: "What is Vyn?",
        a: "Vyn (Vínculo) is a DeFi platform that builds your financial identity on the blockchain. By saving in our smart contract, you generate a reputation score that gives you access to microcredits without traditional bureaucracy.",
      },
      {
        q: "How do I level up?",
        a: "Your level (Bronze, Silver, Gold...) depends on your Reputation Score. It is calculated by an algorithm that rewards the consistency of your deposits and the time you keep your funds in the contract. The higher the score, the higher the credit limit.",
      },
      {
        q: "What are NFT levels?",
        a: "Each level is a Soulbound Token (SBT). It is a special NFT linked to your wallet that cannot be transferred or sold. It is your 'badge' of good payer and saver on the Stellar network.",
      },
      {
        q: "What network does Vyn operate on?",
        a: "We currently operate on Stellar Testnet (Test Network). This lets you try all features without using real money while we complete the audit phase.",
      },
      {
        q: "How do I withdraw my credit?",
        a: "Once you reach Silver Level (50 reputation pts), the 'Withdraw Credit' option will be automatically enabled in your profile. The amount will be sent directly to your Freighter wallet.",
      },
      {
        q: "Are my funds safe?",
        a: "Absolutely. Vyn uses Smart Contracts on Soroban (Stellar). Funds are locked under cryptographic rules that only you control with your digital signature in Freighter.",
      },
    ],
  },

  nft_modal: {
    badge: "Accredited NFT",
    title: "Congratulations!",
    subtitle:
      "Your reputation NFT has been successfully minted on the Stellar network.",
    meta_level: "Level Reached",
    meta_deposits: "Deposit History",
    meta_volume: "Protected Volume",
    meta_owner: "Owner",
    explorer_link: "View on StellarExpert",
    accept_button: "Accept and Continue",
    nft_alt: "NFT Level {{level}}",
  },

  not_found: {
    title: "404",
    message: "Oops! Page not found",
    return_home: "Return to Home",
  },
} as const;

export default en;
