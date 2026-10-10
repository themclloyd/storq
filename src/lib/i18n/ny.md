/**
 * Chichewa (ny) message catalog. Keys mirror `en.ts` (the structural source of
 * truth); anything omitted here falls back to English automatically.
 *
 * TRANSLATION NOTES for a native reviewer (marked `// REVIEW:` inline):
 * - Confirmed glossary (owner-approved): POS/till = "Kugulitsa", layby =
 *   "Ngongole", expenses = "Zotulutsa", reports = "Malipoti". Use these terms
 *   consistently across every screen.
 * - Modern retail terms with no established Chichewa word use a common loanword
 *   (Dashibodi, PIN, imelo, cookie) so a Malawian shopkeeper recognises them.
 */
export const ny = {
  common: {
    save: "Sungani",
    cancel: "Lekani",
    close: "Tsekani",
    back: "Bwererani",
    tryAgain: "Yesaninso",
    loading: "Tikudikirani…", // REVIEW: "loading" has no exact term; confirm intent
    confirming: "Chonde dikirani…",
    confirm: "Tsimikizani",
    yes: "Inde",
    no: "Ayi",
    search: "Sakani",
    actions: "Zochita",
    edit: "Konza",
    delete: "Chotsani",
    add: "Onjezani",
    create: "Pangani",
    name: "Dzina",
    none: "Palibe",
    all: "Zonse",
    today: "Lero",
    online: "Pa intaneti",
    workspace: "Malo ogwirira ntchito",
    total: "Yense",
    apply: "Gwiritsani", // REVIEW: apply (a % / discount)
    saved: "Zasungidwa",
  },
  nav: {
    dashboard: "Dashibodi",
    pos: "Kugulitsa",
    cashDrawer: "Bokosi la ndalama",
    salesHistory: "Mbiri ya malonda",
    approvals: "Zovomereza",
    laybys: "Ngongole",
    items: "Zinthu",
    transfers: "Kusamutsa",
    collections: "Magulu", // REVIEW: product groups — "Magulu" vs "Gulu"
    stocktakes: "Kuwerengera katundu",
    overview: "Chidule",
    reports: "Malipoti",
    expenses: "Zotulutsa",
    locations: "Malo",
    stores: "Masitolo",
    staff: "Ogwira ntchito",
    subscription: "Kulembetsa",
    settings: "Zokonda",
    sales: "Malonda",
    inventory: "Katundu",
    finance: "Zachuma",
    selectStore: "Sankhani sitolo",
    lockWorkspace: "Tsekani malo ogwirira ntchito",
    lock: "Tsekani",
  },
  roles: {
    admin: "Woyang'anira",
    manager: "Mtsogoleri / Wovomereza",
    cashier: "Wolandila",
  },
  localeNames: {
    en: "Chingelezi",
    ny: "Chichewa",
    switch: "Sinthani chilankhulo",
  },
  offline: {
    online: "Pa intaneti",
    offlineSaved: "Palibe intaneti — malonda asungidwa pa chipangizochi",
    waitingToSync: "Malonda {count} akudikira kugwirizanitsidwa",
    unlockToSync: " (isani ndi PIN kuti mugwirizanitse)",
    syncNow: "Gwirizanitsani tsopano",
    notRecorded: "Malonda opanda intaneti {amount} siolelezidwa:",
    retry: "Yesani kachiwiri",
    discard: "Tayani",
    discardConfirm: "Mufuna kutaya malonda awa opanda intaneti? Siwolelezidwa.",
  },
  errors: {
    noAccess: "Mulibe ufulu wowona data iyi",
    generic: "Pachitika vuto. Chonde yesaninso.",
    pageNotFoundTitle: "Tsamba silipezeka",
    pageNotFoundBody: "Tsamba lomwe mukupenda silipo kapena lasunjidwa.",
    pageDidntLoad: "Tsamba lino silinatsegukere",
    pageDidntLoadBody:
      "Pachitika vuto kumbali yathu. Mungayese kubwezeretsa kapena kubwerera kunyumba.",
    goHome: "Bwererani kunyumba",
    tooManyAttempts: "Mayeso ambiri kwambiri — yesaninso pang'ono.",
  },
  validate: {
    required: "{label} iyenera kuzazidwa",
    tooLong: "{label} siyenera kupitilira zolembera {max}",
    unsafe: "{label} siyenera kukhala ndi <, >, backticks kapena zolembera zowongolera",
    emailRequired: "Imelo iyenera kuzazidwa",
    emailTooLong: "Imelo ndi yayitali kwambiri",
    emailChars: "Imelo ili ndi zolembera zosaloledwa",
    emailInvalid: "Lembani adilesi ya imelo yolungamiza",
    passwordRequired: "Mawu achinsinsi ayenera kuzazidwa",
    passwordShort: "Gwiritsani ntchito zolembera osachepera 8",
    passwordLong: "Gwiritsani ntchito zolembera {max} kapena pang'ono",
    passwordChars: "Mawu achinsinsi ali ndi zolembera zosaloledwa",
    passwordPattern: "Khala ndi kalata limodzi ndi nambala limodzi",
    pinRequired: "PIN iyenera kuzazidwa",
    pinRange: "PIN iyenera kukhala manambala {min} kufika {max}",
    phoneRequired: "Nambala ya foni iyenera kuzazidwa",
    phoneLength: "Foni siyenera kupitilira zolembera {max}",
    phoneChars: "Gwiritsani ntchito manambala, +, ( ) ndi - zokha",
    amountNumber: "{label} iyenera kukhala nambala",
    amountWhole: "{label} iyenera kukhala nambala yathunthu",
    amountMin: "{label} iyenera kukhala {min} kapena kuposerapo",
    amountMax: "{label} iyenera kukhala {max} kapena pang'ono",
    skuInvalid: "Barcode/SKU igwiritse ntchito makale, manambala, mpata ndi . _ - zokha (max 64)",
    currencyLength: "Chizindikiro cha ndalama siyenera kupitilira zolembera {max}",
    currencyChars: "Chizindikiro cha ndalama chili ndi zolembera zosaloledwa",
  },
  setup: {
    title: "Konzani bizinisi yanu",
    subtitle: "Mutha kuonjezera masitolo ndi ogwira ntchito ena mtsogolo.",
    businessName: "Dzina la bizinisi",
    currency: "Mtundu wa ndalama",
    firstStore: "Sitolo yoyamba",
    storeName: "Dzina la sitolo",
    storeType: "Mtundu wa sitolo",
    directSale: "Malonda achindunji",
    approvalBased: "Zofuna kuvomerezedwa",
    yourName: "Dzina lanu",
    yourAdminPin: "PIN yanu yoyang'anira",
    createBusiness: "Pangani bizinisi",
    signOutDevice: "Tulukani pa chipangizochi",
    businessReady: "Bizinisi yakonzeka. Lowetsani PIN yanu.",
    checkingSubscription: "Tikuona kulembetsa…",
    subscriptionError: "Sikunathe kuona kulembetsa.",
  },
  pin: {
    enterPin: "Lowetsani PIN yanu",
    wrongPin: "PIN yolakwika, yesaninso",
    signOutDevice: "Tulukani pa chipangizochi",
  },
  auth: {
    brandTag: "Storq · Malo ogwirira ntchito a bizinisi",
    newToStorq: "Ndinso watsopano ku Storq?",
    alreadyHaveAccount: "Muli ndi akaunti kale?",
    createAccount: "Pangani akaunti",
    signIn: "Lowani",
    welcomeBack: "Takulandiranso.",
    createYourAccount: "Pangani akaunti yanu.",
    resetYourPassword: "Bwezeretsani mawu anu achinsinsi.",
    chooseNewPassword: "Sankhani mawu atsopano achinsinsi.",
    pickStrongPassword: "Sankhani mawu achinsinsi olimba akaunti yanu ya bizinisi.",
    emailResetHint: " Tidzakutumizirani imelo yotetezeka yokonza mawu achinsinsi atsopano.",
    oneAccountHint: "Akaunti imodzi ya bizinisi yanu. PIN ya ogwira ntchito ibwera kotsatira.",
    businessEmail: "Imelo ya bizinisi",
    password: "Mawu achinsinsi",
    passwordHint: "Zolembera osachepera 8 okhala ndi kalata limodzi ndi nambala limodzi.",
    sendResetLink: "Tumizani lumikiziro lobwezeretsa",
    updatePassword: "Sinthani mawu achinsinsi",
    forgotPassword: "Mwaiwala mawu anu achinsinsi?",
    backToSignIn: "Bwererani ku kulowa",
    checkYourEmail: "Onani imelo yanu",
    resetSent:
      "Tatumiza lumikiziro lobwezeretsa mawu achinsinsi ku {email}. Litseguleni pa chipangizochi kuti musankhaninso mawu achinsinsi.",
    confirmSent:
      "Tatumiza lumikiziro lotsimikizira ku {email}. Litseguleni pa chipangizochi kuti mupitirize.",
    passwordUpdated: "Mawu achinsinsi asinthidwa — mwalowa.",
  },
  consent: {
    ariaLabel: "Loleza ma cookie",
    title: "Timagwiritsa ntchito ma cookie",
    body: "Ma cookie ofunikira zimakusungani mukumulowa. Ena osafunikira zithandiza kuona momwe masitolo agwiritsira ntchito Storq. Sitigulitsa data ya bizinisi yanu.",
    acceptAll: "Landirani zonse",
    necessaryOnly: "Zofunikira zokha",
  },
  dashboard: {
    title: "Dashibodi",
    sales: "Malonda",
    salesCount: "Malonda {count}",
    expenses: "Zotulutsa",
    allSources: "Magwero onse",
    grossProfit: "Phindu lalikulu",
    grossProfitSub: "Malonda ochotsedwa mtengo wa katundu",
    netProfit: "Phindu lenileni",
    netProfitSub: "Pambuyo pa zotulutsa",
    byHour: "Malonda ndi zotulutsa pa ola",
    byDay: "Malonda ndi zotulutsa pa tsiku",
    paymentMethods: "Njira zolipirira",
    paymentMethodsNote: "Momwe makasitomala analipirira",
    notifications: "Zidziwitso",
    notificationsNote: "Zikufuna chisamaliro chako",
    allClear: "Zonse ndi bwino — palibe chikufuna chisamaliro pano.",
    profitVisibilityNote:
      "Phindu limasonyezera eni ake ndi oyang'anira kokha pa tsamba la Malipoti.",
    needsReorder: "Zofunika kuyitanzanso", // REVIEW: "reorder" wording
    reorderNote: "{count} zinthu zili pansi pa mzere woyitanzira", // REVIEW: "reorder point"
    checkingStock: "Tikuona mlingo wa katundu…",
    nothingBelowReorder: "Palibe chinthu chili pansi pa mzere woyitanzira.",
    reorderLine: "{name} — {qty} yasala, yitanizani pa {point}",
    alertInvoices: "Ma invusi {count} akudikira kuvomerezedwa",
    alertLaybys: "Ngongole {count} zotseguka zili ndi zotsalira zolipira",
    alertLowStock: "Katundu wochepa: {name} ({qty} yasala)",
    genericItem: "Chinthu",
    profit: "Phindu",
    amount: "Kuchuluka",
    noActivity: "Palibe zochita m'nthawi inoyi pano.",
    noSalesPeriod: "Palibe malonda m'nthawi inoyi pano.",
    nothingToShow: "Palibe zowonetsa pano.",
    noSalesInPeriod: "Palibe malonda m'nthawi inoyi.",
  },
  status: {
    completed: "Chamalipiridwa",
    layby_completed: "Ngongole zalipiridwa",
    pending_approval: "Ikudikira kuvomerezedwa",
    layby_open: "Ngongole yapatseguka", // REVIEW: layby still being paid
    rejected: "Zokana",
    layby_cancelled: "Ngongole yathletsedwa",
    open: "Ikuko",
    closed: "Yatsekedwa",
    refunded: "Chabweledwa",
    partially_refunded: "Chabweledwa pang'ono",
    approval: "Kuvomereza",
    directSale: "Kugulitsa kotseguka",
  },
  till: {
    metaTitle: "Kugulitsa — Storq",
    metaDesc: "Yendetsani kugulitsa ndipo popani invoice za ngongole kapena zovomerezedwa.",
    searchLabel: "Sakani zinthu kapena SKU",
    searchPlaceholder: "Sakani zinthu kapena SKU (/)",
    all: "Zonse",
    noItemsYet:
      "Palibe zinthu pakadali pano. Woyang'anira kapena mtsogoleri atha kuzowonjezera mu Katundu.",
    noMatchingItems: "Palibe zinthu zofanana.",
    inStock: "{count} zilipo",
    currentSale: "Kugulitsa kwa pano", // REVIEW
    currentInvoice: "Invoice ya pano",
    tapItems: "Dinani zinthu kuti muziwonjezera.",
    eachWord: "pa chimodzi",
    lineItems: "Zinthu",
    vat: "VAT",
    included: "zaphatikizidwa",
    added: "zowonjezedwa",
    charge: "Lipitsani {amount}", // REVIEW
    sendForApproval: "Tumizani kuti avomereze",
    startLayby: "Yambani ngongole",
    laybyInvoice: "Invoice ya ngongole",
    addDiscount: "Onjezani kuchotsera",
    discountApplied: "Kuchotsera · -{amount}",
    noBarcodeMatch: "Palibe chinthu chofanana ndi barcode {code}",
    noInternetSale:
      "Palibe intaneti — kugulitsa kwa {amount} kwasungidwa pa chipangizochi ndipo kusamutsa zidzachitika zokha.",
    changeSuffix: " Zosinthira: {amount}",
    invoiceSentApproval: "Invoice #{no} yatumizidwa kuti ivomerezedwe",
    addStoreFirst: "Onjezani sitolo kaye.",
    payCash: "Ndalama",
    payCard: "Khadi",
    payMobile: "Ndalama pa foni",
    titleInvoiceApproval: "Invoice ya kuvomereza",
    titleLaybyApproval: "Invoice ya ngongole ya kuvomereza",
    titleStartLayby: "Yambani ngongole",
    titleTakePayment: "Tolani ndalama",
    subApprovalInvoice: "Invoice ya kuvomereza",
    subLayby: "Ngongole",
    subDirectSale: "Kugulitsa kotseguka",
    invoiceTotal: "Mulingo wa invoice", // REVIEW
    amountDue: "Ndalama zolipira",
    approvalNote:
      "Wovomereza ayenera kuvomereza izi katundu asachoke mu sitolo ndalama zisanalembedwe.",
    paymentMethod: "Njira yolipirira",
    payment1Method: "Njira yolipirira 1",
    labelAmount: "Mulingo",
    labelDepositPaidNow: "Ndalama zolipiridwa pano",
    labelCashReceived: "Ndalama zolandiridwa",
    tenderExact: "Zolondola", // REVIEW
    tenderFullAmount: "Mulingo wathunthu",
    ariaPaymentAmount: "Mulingo wolipira {no}",
    ariaRemovePayment: "Chotsani kulipira",
    addAnotherPayment: "Onjezani kulipira kwina",
    remainingDue: "Zotsalira zolipira",
    changeDue: "Zosinthira",
    managerPinOverCap: "PIN ya mtsogoleri (kuchotsera kupitilira mulingo wako)",
    enterManagerPin: "Lembani PIN ya mtsogoleri",
    customerNameRequired: "Dzina la kasitomala *",
    customerName: "Dzina la kasitomala",
    phoneLabel: "Foni",
    noteForApprover: "Zolemba kwa wovomereza", // REVIEW
    completeSale: "Malizani kugulitsa · {amount}",
    openLayby: "Tsegulani ngongole",
    discountsTitle: "Zochotsera",
    cashierCapNote:
      "Kuchotsera mpaka {pct}% pa mzere ndi pa dengu lonse. Zopitilira zifuna PIN ya mtsogoleri pa kulipira.", // REVIEW: "dengu" for basket
    lineLimitNote: "Zochotsera zimalingizidwa kukwana kwa mzere uliwonse.",
    applyPctToAll: "Gwiritsani % pa mizere yonse",
    ariaDiscountFor: "Kuchotsera kwa {name}",
    ariaClearDiscountFor: "Chotsani kuchotsera kwa {name}",
    overCap: "zapitilira mulingo",
    totalDiscount: "Kuchotsera konse",
    capAlert:
      "Izi zapitilira mulingo wako wa {pct}%. Mtsogoleri ayenera kuzivomereza — lembani PIN yawo pa sitepe yotsatira (zivomerezedwa pa kugulitsa, sizisungidwa).",
    applyAmountOff: "Chotsani {amount}",
    scanBarcode: "Sani barcode",
    scanCameraAria: "Sani barcode ndi kamera",
    scanCameraTitle: "Sani ndi kamera",
    holdCode: "Ikani code pamaso pa kamera.",
    lastSeen: " Zomwe zinaoneka: {code}",
    noBarcodeSupport: "Kasakatuli uyu sunathe kusani mabarcodes.", // REVIEW: "kasakatuli" = browser
    cameraBlocked: "Kuwona kwa kamera kzatseka — lolani, kapena gwiritsani chosanja cha barcode.",
    noItemMatches: "Palibe chinthu chofanana ndi {code}",
    cameraPreviewAria: "Chionetsero cha kamera",
    closeCamera: "Tsekani kamera",
    saleComplete: "Kugulitsa Kwathera", // REVIEW
    laybyOpened: "Ngongole Yapatseguka", // REVIEW
    laybyFullyPaid: "Ngongole Zalipiridwa Yense",
    receiptDownloaded: "PDF ya risitali yatsitsidwa.",
    printPopupBlock: "Lolani ma-popup kuti musindikize risitali.",
    newSale: "Kugulitsa Katsopano",
    print: "Sindikani",
  },
  doc: {
    receipt: "Risitali",
    laybyReceipt: "Risitali ya ngongole",
    item: "Chinthu",
    qty: "Muchulidwe",
    unitPrice: "Mtengo pa chimodzi",
    amount: "Mulingo",
    date: "Tsiku",
    servedBy: "Wogulitsa", // REVIEW: served by / cashier
    payment: "Kulipira",
    customer: "Kasitomala",
    walkIn: "Mlendo", // REVIEW: walk-in customer
    subtotal: "Mulingo wa zinthu", // REVIEW
    paid: "Zolipiridwa", // REVIEW
    change: "Zosinthira",
    total: "Yense",
    noteLabel: "Zolemba:", // REVIEW
    thankYou: "Zikomo chifukwa chogula na ife.",
    invoice: "Invoice",
    method: "Njira",
    deposit: "Ndalama zoyamba", // REVIEW
    discount: "Kuchotsera",
    split: "Kulipira kogawidwa", // REVIEW: split payment
    titleSaleReceipt: "RISITALI YA KUGULITSA",
    titleLaybyReceipt: "RISITALI YA NGONGOLE",
    titleLaybyPaid: "NGONGOLE ZALIPIRIDWA YENSE",
    badgePaid: "ZALIPIDWA",
    badgeLaybyOpen: "NGONGOLE IKUKO",
    badgeLaybyPaid: "NGONGOLE ZALIPIDWA",
    thankYouKeep: "Zikomo — sungani risitali ineyi.",
    poweredBy: "Zoyendetsedwa ndi Storq", // REVIEW
    storeCredit: "Ngongole ya sitolo", // REVIEW: store credit
    taxInvoice: "Invoyisi ya msonkho", // REVIEW: tax invoice
    laybyStatement: "Chikalata cha Ngongole", // REVIEW: layby statement
    walkInCustomer: "Kasitomala wolowera", // REVIEW: walk-in customer
    thankYouBusiness: "Zikomo chifukwa pogula nafe.",
    badgeRefunded: "ZABWEZEDWA",
    badgePartRefunded: "ZABWEZA PANG'ONO",
    badgeAwaiting: "ZIKUDIKIRA CHILOLEZO",
    badgeRejected: "ZOKANA",
    badgeCancelled: "ZANETSEKWA",
  },
  inv: {
    noAccess: "Oyang'anira ndi mtsogoleri okha angathe kasamalira katundu.",
    title: "Katundu",
    stockValueCost: "kuchuluka kwa katundu m'mtengo wogula",
    importCsv: "Leterani CSV", // REVIEW: import
    exportCsv: "Tumizani CSV",
    exportPdf: "Tumizani PDF",
    newItem: "Chinthu chatsopano",
    lowStock: "Katundu wochepa",
    noItemsYet: "Palibe zinthu pakadali pano.",
    cost: "Mtengo wogula",
    price: "Mtengo wogulitsira",
    inStock: "Zilipo",
    btnStock: "Katundu",
    reportTitle: "Lipoti la katundu",
    reportSubtitle: "katundu opezeka",
    reportBadge: "KATUNDU",
    kpiItems: "Zinthu",
    kpiUnits: "Zinthu zilipo", // REVIEW: units on hand
    kpiValueCost: "Kuchuluka m'mtengo wogula",
    kpiValueRetail: "Kuchuluka m'mtengo wogulitsira",
    thCollections: "Magulu",
    thStockValue: "Kuchuluka kwa katundu",
    hiddenSuffix: " (yobisika)",
    editItem: "Konzani chinthu", // REVIEW: edit
    skuBarcode: "SKU / barcode",
    costPrice: "Mtengo wogula",
    sellingPrice: "Mtengo wogulitsira",
    buyingCost: "Mtengo wogula",
    collectionsLabel: "Magulu",
    noCollections: "Palibe magulu pakadali pano — opangani mu Magulu.",
    reorderPoint: "Mulingo woyitanizira (kosakakamiza)", // REVIEW: reorder
    reorderPointField: "Mulingo woyitanizira", // REVIEW
    reorderPlaceholder: "Ledzani katundu akatsika ku mulingo umu",
    quantity: "Kuchuluka",
    currentlyInStock: "pakadali pano {qty} zilipo — musasinthe kuti zikhalire", // REVIEW
    startingStock: "katundu woyamba wa sitolo ineyi",
    availableForSale: "Zopezeka kugulitsa",
    saveItem: "Sungani chinthu",
    changeStock: "Sinthani katundu",
    historyTab: "Mbiri",
    addStock: "Onjezani katundu",
    removeStock: "Chotsani katundu",
    reasonLabel: "Chifukwa",
    noteOptional: "Zolemba (kosakakamiza)",
    noteField: "Zolemba",
    notePlaceholder: "Nom. ya invoice, amene anayleterera…", // REVIEW
    noMovements: "Palibe zosuntha pakadali pano.",
    stockUpdated: "Katundu wasinthidwa",
    errNoRows: "Fayiloli ilibe mizere ya zinthu.",
    errNeedName: 'Fayilo lifunika kholumu ya "name". Tumizani kaye kuti mupeze timangililo.', // REVIEW
    errName: "Dzina losowa kapena la ngozi",
    errSku: "SKU yolakwika",
    errNumber: "Nambala yolakwika",
    importItemsTitle: "Leterani zinthu",
    newWord: "zatsopano",
    updatesWord: "zosintha",
    skippedWord: "zophunyidwa", // REVIEW: skipped
    qtySetNote: 'Kuchuluka kwa ikidwa pa {store} ndipo kulembedwa ngati "CSV import".', // REVIEW
    updateTag: "Zosintha",
    newTag: "Zatsopano",
    columnsHint:
      "Makholumu: name, sku, cost, price, quantity, active. Zinthu zifananso ndi SKU, kenaka dzina.",
    importing: "Muleteretsa {done}/{total}…",
    importItems: "Leterani zinthu {count}",
    itemsImported: "Zinthu {count} zaleteredwa",
    importedFailed: "{ok} zaleteredwa, {fails} zalephera",
  },
  reason: {
    sale: "Kugulitsidwa",
    sale_reversal: "Kugulitsa kanetsedwa",
    refund_restock: "Kobweretsa kwa kasitomala",
    stocktake: "Kuwerengera katundu",
    opening_balance: "Kuchuluka koyamba",
    adjustment: "Kukonza",
    supplier_intake: "Kubweretsa kwa wogulitsa",
    transfer_in: "Kusamutsa kolandira",
    transfer_out: "Kusamutsa kotumiza",
    correction: "Kulondoleza",
    damage: "Zoonongeka",
    shrinkage: "Zinatayika / Zinabaika", // REVIEW: lost / stolen
    return_to_supplier: "Zinabwerera kwa wogulitsa",
    p_supplier_intake: "Kubweretsa kuchokera kwa wogulitsa",
    p_transfer_in: "Kusamutsa kuchokera ku sitolo ina",
    p_correction: "Kulondoleza kuwerengera",
    p_damage: "Zoonongeka",
    p_shrinkage: "Zinatayika / Zinabaika", // REVIEW
    p_return_to_supplier: "Zinabwerera kwa wogulitsa",
    p_transfer_out: "Kusamutsa kupita ku sitolo ina",
  },
  sales: {
    title: "Malonda",
    rangeToday: "Lero",
    range7d: "Masiku 7",
    range30d: "Masiku 30",
    allStores: "Masitolo onse",
    reportTitle: "Lipoti la malonda",
    netSales: "Malonda oyera", // REVIEW: net sales (after refunds)
    collected: "Zolandiridwa",
    refunds: "Zobwezedwa",
    transactions: "Zochitika",
    colStore: "Sitolo",
    colStatus: "Mkhalidwe", // REVIEW: status
    colStaff: "Ogwira ntchito",
    colRefunded: "Zobweza",
    colDetails: "Zambiri",
    noSales: "Palibe malonda m'nthawi inoyi.",
    showMore: "Onetsani zina",
    leftWord: "zotsala",
  },
  sdetail: {
    saleTitle: "Kugulitsa #{number}",
    notFound: "Palibe kugulitsa kopezekaka.",
    backToSales: "Bwerera ku Malonda",
    by: "ndi {name}",
    staffWord: "ogwira ntchito",
    returnRefund: "Bweza / Zolipira", // REVIEW: return / refund
    net: "Yoyera", // REVIEW: net
    balanceDue: "Zolipira zotsala",
    approvedBy: "Zololezedwa ndi",
    billedTo: "Yainidontholedwa kwa", // REVIEW: billed to
    itemsCard: "Zinthu",
    refundsCard: "Zobweza",
    refundWord: "Kubweza",
    noRefunds: "Palibe zobweza pa kugulitsa uku.",
    refundNumber: "Kubweza #{number}",
    returnTitle: "Bweza zinthu kuchokera pa kugulitsa #{number}",
    returnableOf: "{left} mwa {qty} zotheka kubweza",
    each: "iliyonse",
    returned: "zabwezedwa",
    returnedCount: "{count} zabwezedwa",
    scrapped: "(zonongoka)", // REVIEW: scrapped
    refundHint:
      'Ndalama zobweza zikuphatikiza msonkho amene kasitomala analipira. Siyani "Bwezera ku shelfu" pa zinthu zoonongeka.',
    refundBy: "Bweza kudzera mwa",
    backToShelf: "Bwezera ku shelfu",
    reasonPlaceholder: "Zoonongeka, sikulo lolakwika…",
    refundBtn: "Bweza {amount}",
    refundToast: "Kubweza #{number} — bweza ndalama {amount}",
    noteCard: "Zolemba",
    downloadPdf: "Tengani PDF",
  },
  laybys: {
    title: "Ngongole",
    sub: "Katundu umasungidwa mpaka kasitomala alipire yense.",
    openTab: "Zotseguka",
    closedTab: "Zotsekedwa",
    searchPlaceholder: "Sakani kasitomala kapena nambala",
    none: "Palibe ngongole pano.",
    noPhone: "palibe foni",
    owing: "Zolipira",
    takePayment: "Landira ndalama",
    cancelConfirm:
      "Udzime ngongole #{number}? Zinthu zibwerera ku katundu. Bweza {amount} pawokha.", // REVIEW
    fullyPaid: "Ngongole yalipidwa yonse — perekani zinthu",
    paymentRecorded: "Kulipira kolembedwa",
    payTitle: "Kulipira ngongole — {customer}",
    recordPayment: "Lembani kulipira",
  },
  invoices: {
    title: "Ma-invoice", // REVIEW: invoices
    subApprover: "Vomerezani ma-invoice kuti mutulule katundu ndipo mulembetu kulipira.",
    subStaff: "Ma-invoice amene inu ndi ena mutumiza kuti avomerezedwe.",
    directSaleNotice:
      "{store} ndi sitolo yogulitsa mwachindunji — kugulitsa kumaliza pa till. Sinthani ku sitolo ya chilolezo kuti muwone ma-invoice.", // REVIEW
    nothingWaiting: "Palibe zikudikira.",
    laybyTag: "Ngongole",
    recentlyReviewed: "Zomwe zayang'aniridwa posachedwa",
    noneYet: "Palibe pakadali pano.",
    reject: "Kana",
    approve: "Vomereza",
    approvedToast: "Invoice #{number} yavomerezedwa",
    rejectedToast: "Invoice #{number} inakanidwa",
    approveTitle: "Vomereza invoice #{number}",
    paymentMethod: "Mtundu wolipira",
    onAccount: "Pa akaunti / EFT",
    depositReceived: "Deposit yolandiridwa", // REVIEW: deposit received
    approveRelease: "Vomereza & tululani katundu",
  },
  exp: {
    title: "Zotulutsa",
    recordExpense: "Lembani chotulutsa",
    recorded: "Chotulutsa chalembetsa", // REVIEW: expense recorded
    deleteConfirm: "Muchotsa chotulutsa chimenechi?",
    reportTitle: "Lipoti la Zotulutsa",
    totalSpent: "Zonse zotulutsidwa",
    paidFromTill: "Zolipidwa ndi kachachi", // REVIEW: paid from till
    entries: "Zolembedwa", // REVIEW: entries
    byCategory: "Mwa gulu", // REVIEW: by category
    allExpenses: "Zotulutsa zonse",
    category: "Gulu", // REVIEW: category
    paidFrom: "Zolipira kuchokera", // REVIEW: paid from
    byCol: "Ndi",
    note: "Zolemba",
    noteOptional: "Zolemba (kosakakamiza)",
    notePlaceholder: "mwachitsanzo: Mafuta ya jenereta",
    saveExpense: "Sungani chotulutsa",
    totalExpenses: "Zonse zotulutsa",
    none: "Palibe zotulutsa m'nthawi inoyi.",
    deleteAria: "Chotsani chotulutsa",
    srcTill: "Ndalama za pa kachachi", // REVIEW: cash from till
    srcBank: "Banki / Kadi",
    srcMobile: "Ndalama pa foni",
    range90d: "Masiku 90",
  },
  col: {
    title: "Magulu",
    onlyAdmins: "Admin ndi manejala kokha angasinthitse magulu.", // REVIEW
    linkCopied: "Cholumikizira chakopedwa", // REVIEW: link copied
    listSub:
      "Konzani zinthu m'magulu, ziwonetsereni makasitomala ndi kuchotsera mtengo pa gulu lonse.", // REVIEW
    newCollection: "Gulu latsopano",
    noneYet: "Palibe magulu pakadali pano.",
    itemsCount: "{count} zinthu",
    open: "Tsegulani", // REVIEW: open
    share: "Perekani",
    notShared: "Zosaperekedwa", // REVIEW: not shared
    collectionWord: "Gulu",
    notFound: "Gulu silipezeka.",
    loadError: "Sistinathe kupeza gulu ili.", // REVIEW: Could not load this collection
    notSharedOrGone: "Gulu ili silaperekedwa kapena silisalipo.", // REVIEW
    offEverything: "{pct}% kuchotsera pa zonse",
    noItemsWord: "Palibe zinthu pakadali pano.",
    visitInStore: "Bwerani ku sitolo kuti mugule · Mopangidwa ndi Storq", // REVIEW: Powered by
    saved: "Gulu lasungidwa",
    deleteConfirm: "Muchotse gulu ili? Zinthu zidzakhalabe mu katundu.", // REVIEW
    offPct: "−{pct}% kuchotsera",
    saving: "Kusunga…",
    details: "Tsatanetsatane", // REVIEW: details
    discountPct: "Kuchotsera %",
    discountHint:
      "Zimagwira ntchito pa chinthu chilichonse mu gulu ili pa nthawi ya kugulitsa. Ngati chinthu chili m'magulu angapo, kuchotsera kwakukulu kumagwiritsidwa ntchito.", // REVIEW
    shareHint: "Aliyense ali ndi cholumikizira angathe kuona", // REVIEW
    itemsHeading: "Zinthu mu gulu ili ({count})",
    remove: "Chotsani",
    noItemsAdd: "Palibe zinthu pakadali pano. Onjezani pansipa.",
    addItems: "Onjezani zinthu",
    searchItems: "Sakani zinthu",
    add: "Onjezani",
    noMore: "Palibe zinthu zina zongezeka.", // REVIEW
    changesKept: "Zosintha zisungidwa mukadina 'Kusunga'.", // REVIEW
  },
  stk: {
    title: "Kuwera katundu", // REVIEW: stock take
    started: "Kuwera katundu kwayamba", // REVIEW: stock take started
    subCounting: "Kuwera {store} kuyambira {date}. Aliyense angathe kuwera pa chipangizo chake.", // REVIEW
    subIdle: "Werani zinthu zili zoona mu {store}.", // REVIEW
    start: "Yambani kuwera katundu",
    noneOpen: "Palibe kuwera katundu koatsegulika. Funani manejala kuti atsegule.", // REVIEW
    startedWord: "Zayambira", // REVIEW: started
    closedWord: "Zotseka", // REVIEW: closed
    noPast: "Palibe zowera zapita.", // REVIEW: no past stock takes
    closeConfirm:
      "Mukatseke kuwera katundu? Zinthu zowerera zidzasandutsa makhalidwe a katundu waposapa.", // REVIEW
    levelsUpdated: "Makhalidwe a katundu asinthidwa", // REVIEW: stock levels updated
    findItem: "Sakani chinthu",
    notCounted: "Zisawerabe", // REVIEW: not counted yet
    countedStat: "{counted} / {total} zawerwa", // REVIEW: counted
    finish: "Malerani & sinthani katundu", // REVIEW: finish & update stock
    systemWord: "Sistem", // REVIEW: system
    countPh: "Werani",
    nothing: "Palibe zowonetsedwa.",
  },
  trf: {
    title: "Kusamutsa katundu", // REVIEW: stock transfers
    onlyAdmins: "Admin ndi manejala kokha angasamutse katundu pakati pa masitolo.", // REVIEW
    storeWord: "Sitolo",
    cancelConfirm: "Muchotse kusamutsa uku? Katundu udzabwerera ku sitolo yotumayo.", // REVIEW
    receivedToast: "Katundu walandidwa", // REVIEW: stock received
    cancelledToast: "Kusamutsa kwachotsedwa", // REVIEW: transfer cancelled
    sub: "Tumizani katundu kuchokera ku {store} ndi kulandira ku sitolo yolowera.", // REVIEW
    yourStore: "sitolo yanu",
    newTransfer: "Kusamutsa kwatsopano",
    needSecond: "Onjezani malo lobiri asanathe kusamutsa katundu pakati pa masitolo.", // REVIEW
    loading: "Kulatsoledwa zosamutsa…", // REVIEW
    none: "Palibe zosamutsa pakadali pano.",
    transferNumber: "Kusamutsa #{number}",
    statusInTransit: "M'njira", // REVIEW: in transit
    statusReceived: "Zalandidwa",
    statusCancelled: "Zachotsedwa",
    unitWord: "yuniti", // REVIEW: unit
    unitsWord: "mayuniti", // REVIEW: units
    acrossWord: "mu", // REVIEW: across
    itemWord: "chinthu",
    itemsWord: "zinthu",
    receiveAt: "Landirani ku {store}",
    receivedWord: "Zalandirwa", // REVIEW: received
    pickTwo: "Sankhani masitolo awiri osiyanasiyana",
    dispatched: "Katundu watumizidwa — ali m'njira", // REVIEW
    newTitle: "Kusamutsa katundu watsopano", // REVIEW
    fromStore: "Kuchokera ku sitolo", // REVIEW: from store
    toStore: "Kupita ku sitolo", // REVIEW: to store
    chooseTwo: "Sankhani masitolo awiri osiyanasiyana.",
    addItems: "Onjezani zinthu",
    searchPh: "Sakani ndi dzina kapena SKU", // REVIEW: search by name or SKU
    noMatch: "Palibe zinthu zofanana.", // REVIEW: no matching items
    transferring: "Zosamutsidwa", // REVIEW: transferring
    qtyFor: "Mulingo wa {name}", // REVIEW: quantity for
    removeFor: "Chotsani {name}",
    noteOptional: "Zolemba (kosakakamiza)",
    dispatch: "Tumizani katundu", // REVIEW: dispatch stock
  },
  shift: {
    title: "Sanduku la ndalama", // REVIEW: cash drawer
    openedToast: "Nthawi yotsegulidwa", // REVIEW: shift opened
    openTitle: "Tsegulani nthawi", // REVIEW: open a shift
    openHint: "Werani ndalama zilizonse za m'sanduku musanayambe kugulitsa.",
    startingFloat: "Ndalama zokamba (float)", // REVIEW: starting cash (float)
    openBtn: "Tsegulani nthawi",
    openLabel: "Nthawi yatsegulidwa", // REVIEW: shift open
    sinceWord: "Kuyambira",
    cashExpected: "Ndalama zoyembekezeredwa m'sanduku",
    drawerActions: "Zochita za sanduku", // REVIEW: drawer actions
    cashInAdd: "Ndalama zolowetsa (onjezerani masinthu)", // REVIEW: cash in (add change)
    cashOutDrop: "Ndalama zotulutsa (kupereka / malipiro)", // REVIEW: cash out (drop / payout)
    closeCount: "Tsekani nthawi & werani", // REVIEW: close shift & count
    past: "Nthawi zapitazo", // REVIEW: past shifts
    noneClosed: "Palibe nthawi zotsekedwa pakadali pano.",
    expectedWord: "Zoyembekezeredwa",
    countedWord: "Zowera",
    managerNote: "Manejala amawona mbiri ya nthawi zonse ndi kusiyana.", // REVIEW
    balanced: "Zolingana", // REVIEW: balanced
    over: "Zowonjezera {amount}", // REVIEW: over
    short: "Zochepa {amount}", // REVIEW: short
    overWord: "Zowonjezera", // REVIEW: over
    shortWord: "Zochepa", // REVIEW: short
    rowStartingFloat: "Ndalama zokamba",
    rowCashSales: "Malonda a ndalama & ngongole", // REVIEW: cash sales & layby payments
    rowCashRefunds: "Ndalama zobwezedwa",
    cashIn: "Ndalama zolowetsa",
    cashOut: "Ndalama zotulutsa",
    rowExpenses: "Zotulutsa zolipidwa ndi kachachi", // REVIEW: expenses paid from till
    rowExpectedCash: "Ndalama zoyembekezeredwa",
    allTakings: "Zolandira zonse mwa njira · malonda {count}", // REVIEW
    recorded: "Zalembedwa", // REVIEW: recorded
    reason: "Chifukwa",
    reasonIn: "Masinthu owonjezera", // REVIEW: added change
    reasonOut: "Ndalama zobisika ku sala", // REVIEW: cash drop to safe
    closeShift: "Tsekani nthawi", // REVIEW: close shift
    closeHint:
      "Werani ndalama zake zonse za m'sanduku ndipo lembani mlingo wonse. Muzawona kusiyana pambuyo potsatsa.", // REVIEW
    cashCounted: "Ndalama zowera", // REVIEW: cash counted
    notesOptional: "Zolemba (kosakakamiza)",
    reportTitle: "Lipoti la mapeto a nthawi", // REVIEW: end of shift report
    openedWord: "Zinatsegulidwa", // REVIEW: opened
    closedWord: "Zinatseka", // REVIEW: closed
    openWord: "Yotseguka", // REVIEW: open
    difference: "Kusiyana", // REVIEW: difference
    notesWord: "Zolemba:",
    takingsByMethod: "Zolandira mwa njira · malonda {count}", // REVIEW
    notes: "Zolemba",
    footerCounted:
      "Zowerengedwa ndi: ____________________      Zoyenderedwa ndi: ____________________", // REVIEW
  },
  staff: {
    title: "Ogwira Ntchito",
    onlyAdmins: "Admin kokha angakonze ogwira ntchito.", // REVIEW
    sub: "Aliyense atsegula chipangizo ichi ndi PIN ya manambala 4 yaokha. PIN yawo imenetsa zomwe angathe kuchita.", // REVIEW
    addBtn: "Onjezani wogwira ntchito",
    roleAdmin: "Admin",
    roleAdminDesc: "Zonse: ogwira ntchito, masitolo, katundu, zovomereza.", // REVIEW
    roleManager: "Manejala / Wovomereza", // REVIEW: manager / approver
    roleManagerDesc: "Gulitsani, vomerezani ma-invoice, konzani katundu ndi kuwera katundu.", // REVIEW
    roleCashier: "Kashiya", // REVIEW: cashier
    roleCashierDesc:
      "Gulitsani, pangani ma-invoice, landirani zolipira za ngongole, werani katundu.", // REVIEW
    autoLockTitle: "Kutseka kwaokha kwa kugulitsa", // REVIEW: till auto-lock
    autoLockDesc:
      "Tsekani chipangizo ichi kubwerera ku PIN pad pambuyo pa nthawi yokhala popanda kugwiritsa ntchito. Kutseka mwachangu nthawi iliyonse ndi Ctrl/Cmd + Shift + L.", // REVIEW
    afterMin: "Pambuyo pa mphindi {n}",
    never: "Osatseka", // REVIEW: never
    inactive: "(sagwira ntchito)", // REVIEW: inactive
    roleLabel: "Ntchito", // REVIEW: role
    storeLabel: "Sitolo",
    editTitle: "Sinthani wogwira ntchito", // REVIEW: edit staff
    newPin: "PIN yatsopano (isiyeni yopanda kanthu kuti mukhale nayo)", // REVIEW: new PIN (leave blank to keep)
    pinLabel: "PIN ya manambala 4", // REVIEW: 4-digit PIN
    active: "Wagwira ntchito", // REVIEW: active
  },
  store: {
    title: "Malo", // REVIEW: locations
    onlyAdmins: "Admin kokha angakonze malo.", // REVIEW
    addBtn: "Onjezani malo",
    freeTrial: "Mayeso aulere", // REVIEW: free trial
    capacityLine: "{used} malo · malo {capacity} olipidwa", // REVIEW: paid location slots
    payMore: "Lipirani malo ena", // REVIEW: pay for more locations
    typeApproval: "Kuvomereza", // REVIEW: approval
    typeDirect: "Kugulitsa kwachindunji", // REVIEW: direct sale
    locationName: "Dzina la malo",
    editTitle: "Sinthani malo",
    directDesc: "Kashiya akugulitsa ndi kulandira malipiro. Katundu amachoka popanda kuchedwa.", // REVIEW
    approvalTitle: "Kufunika kuvomereza", // REVIEW: approval based
    approvalDesc:
      "Kashiya akupanga invoice. Manejala kapena admin avomereza asatchule katundu ndi kulemba malipiro.", // REVIEW
    saveBtn: "Sungani malo",
    taxTitle: "VAT / msonkho wa kugulitsa", // REVIEW: VAT / sales tax
    taxDesc:
      "Zimagwira ntchito pa malo onse. Ikani 0 ngati simulembetsa ku VAT. Malonda akale amasunga msonkho umene anagulitsa nawo.", // REVIEW
    taxRate: "Mlingo wa msonkho", // REVIEW: tax rate
    taxRatePct: "Mlingo wa msonkho (%)",
    taxSaved: "Zoikamo za msonkho zasungidwa", // REVIEW: tax settings saved
    inclTitle: "Mitengo zikuphatikizapo VAT", // REVIEW: prices include VAT
    inclDesc: "Mtengo wa pa shelufu ndi womwe kasitomala alipira.", // REVIEW
    addVatTitle: "Onjezerani VAT pa kugulitsa", // REVIEW: add VAT at till
    addVatDesc: "VAT imawonjezeredwa pamwamba pa mtengo wa pa shelufu.", // REVIEW
    saveTaxBtn: "Sungani zoikamo za msonkho", // REVIEW: save tax settings
  },
  reports: {
    title: "Lipoti la bizinesi", // REVIEW: business report
    onlyAdmins: "Admin ndi manejala kokha angathe kuona malipoti.", // REVIEW
    loading: "Kulatsoledwa lipoti…", // REVIEW
    downloadPdf: "Tsilani PDF", // REVIEW: download PDF
    allStores: "Masitolo onse",
    subtitle: "{scope} · masiku {range} apitawa", // REVIEW: last {range}
    badgePl: "P&L", // REVIEW: profit & loss
    rangeToday: "Lero",
    range7d: "Masiku 7",
    range30d: "Masiku 30",
    range90d: "Masiku 90",
    netSales: "Malonda oyera", // REVIEW: net sales
    netSalesAfterRefunds: "Malonda oyera (pambuyo pa zobwezedwa)", // REVIEW
    statSalesSub: "malonda {count} · {refunds} zobwezedwa", // REVIEW
    buyingCost: "Mtengo wogula", // REVIEW: buying cost
    costOfItemsSold: "Mtengo wa zinthu zogulitsidwa", // REVIEW
    buyingCostSold: "Mtengo wogula wa zinthu zogulitsidwa", // REVIEW
    grossProfit: "Phindu lalikulu", // REVIEW: gross profit
    marginSub: "margin {margin}%", // REVIEW
    grossMargin: "Margin lalikulu", // REVIEW: gross margin
    expenses: "Zotulutsa",
    categoriesSub: "magulu {count}", // REVIEW: categories
    operatingExpenses: "Zotulutsa zoyendetsa bizinesi", // REVIEW: operating expenses
    netProfit: "Phindu loyera", // REVIEW: net profit
    whatYouKeep: "Zomwe mumasunga", // REVIEW: what you keep
    refunds: "Zobwezedwa",
    profitLoss: "Phindu ndi kuchepa", // REVIEW: profit & loss
    byHour: "Malonda vs phindu pa ola", // REVIEW
    byDay: "Malonda vs phindu pa tsiku", // REVIEW
    tillCheck: "Kuyeza ndalama za kachachi", // REVIEW: till cash check
    taxSummary: "Chidule cha msonkho (VAT)", // REVIEW: tax summary
    salesByMethod: "Malonda mwa njira yolipirira", // REVIEW
    expByCategory: "Zotulutsa mwa gulu", // REVIEW
    topItems: "Zinthu zapamwamba mwa phindu", // REVIEW
    staffRevenue: "Kuchita kwa ogwira ntchito — zolandira", // REVIEW
    staffPerf: "Kuchita kwa ogwira ntchito", // REVIEW
    lowMargin: "Zikumbutso za margin yaing'ono (pansi pa 10%)", // REVIEW
    netByStore: "Phindu loyera pa sitolo", // REVIEW
    itemPerf: "Kuchita kwa chinthu", // REVIEW
    stores: "Masitolo",
    cashFromSales: "Ndalama zolandiridwa pa malonda", // REVIEW
    cashPaidOut: "Ndalama zotulutsidwa (zotulutsa)", // REVIEW
    expectedCash: "Ndalama zoyembekezeredwa m'sanduku",
    salesInclTax: "Malonda okhala ndi msonkho", // REVIEW
    vatCollected: "VAT yolandidwa", // REVIEW
    salesExclTax: "Malonda kupanda msonkho", // REVIEW
    thMethod: "Njira",
    thAmount: "Mlingo",
    thCategory: "Gulu", // REVIEW: category
    thItem: "Chinthu",
    thQty: "Mulingo", // REVIEW: qty
    thSales: "Malonda",
    thProfit: "Phindu",
    thMargin: "Margin", // REVIEW
    thStaff: "Ogwira ntchito",
    thRevenue: "Zolandira", // REVIEW: revenue
    thStore: "Sitolo",
    thExpenses: "Zotulutsa",
    thNet: "Zoyera", // REVIEW: net
    noExpenses: "Palibe zotulutsa.",
    noItemsSold: "Palibe zinthu zogulitsidwa.", // REVIEW
    noSales: "Palibe malonda.",
    unknownStaff: "Zisadziwika", // REVIEW: unknown
    lowMarginNote: "Yang'anani mitengo yogulitsira ndi yogulira zinthu izi mu Katundu.", // REVIEW
    footerNote:
      "Phindu limagwiritsa ntchito mtengo wogula umene unayikidwa pa chinthu chilichene chimagulitsidwa. Zobwezedwa zimachotsedwa pa malonda ndi phindu; zinthu zobwezeredwa ku shelufu zimabweza mtengo wazo wogula. Malonda akudikira kuvomereza ndi ngongole zotseguka sizibaloledwa mpaka zikamalizidwa. Kuti mupeze zovomerezeka za sanduku, gwiritsani ntchito nthawi za sanduku la ndalama.", // REVIEW
  },
  billing: {
    title: "Malipiro", // REVIEW: billing
    overLimitTitle: "Masitolo anu aposa malo olipidwa", // REVIEW
    needsAttentionTitle: "Kulembetsa kwanu kufunika chifundo", // REVIEW
    sub: "Mapulani, malipiro ndi ma-invoice anu.", // REVIEW
    planOf: "Mapulani a {plan}", // REVIEW
    noActivePlan: "Palibe mapulani ogwira ntchito", // REVIEW
    statusOverLimit: "Mulingo wa sitolo wathetsedwa", // REVIEW
    statusActive: "Yagwira ntchito", // REVIEW
    statusExpired: "Yatha", // REVIEW: expired
    renewsExpires: "Ikonzanso / imatha {date}", // REVIEW
    trialEnds: "Mayeso atha {date}", // REVIEW
    subscribeToKeep: "Lembetsani kuti mupitirize kugulitsa.", // REVIEW
    perStoreMonth: "pa sitolo / mwezi", // REVIEW
    storesUsed: "masitolo {used} a pa {capacity} agwiritsidwa", // REVIEW
    perMo: "/mwezi", // REVIEW: per month
    switchStaff: "Sinthani wogwira ntchito", // REVIEW
    renewOrExtend: "Ikonzanso kapena kulitsa", // REVIEW
    upgradePlan: "Kwezani mapulani", // REVIEW
    payMethodTitle: "Njira yolipirira",
    payMethodSub: "Sinthani mmene mukulipirira mapulani.", // REVIEW
    lastCard: "Malipiro otsala · Kadi / USD", // REVIEW
    lastMobile: "Malipiro otsala · Mobile money kapena kadi", // REVIEW
    noPaymentYet: "Palibe malipiro pakadali pano", // REVIEW
    payProviders: "Airtel Money, TNM Mpamba kapena kadi kudzera pa PayChangu.", // REVIEW
    update: "Sinthani", // REVIEW
    processedBy: "Malipiro amakonzedwa ndi PayChangu; tsatanetsatane wa kadi susungidwa pa Storq.", // REVIEW
    sectionTitle: "Malipiro ndi ma-invoice", // REVIEW
    sectionSub: "Ma-invoice a malipiro onse a kulembetsa.", // REVIEW
    downloadAll: "Tsilani zonse", // REVIEW
    downloadAllTitle: "Tsilani ma-invoice onse", // REVIEW
    downloadAllDesc:
      "Ma-invoice {count} olipidwa adzatsegulika chimodzimodzi kuti musindikize kapena musunge ngati PDF. Lolani pop-ups pa site iyi.", // REVIEW
    invoiceWord: "Invoice", // REVIEW: loanword
    noPaidInvoices: "Palibe ma-invoice olipidwa pakadali pano.", // REVIEW
    downloadInvoicesBtn: "Tsilani ma-invoice {count}", // REVIEW
    loadingInvoices: "Kulatsoledwa ma-invoice…", // REVIEW
    invoicesError: "Ma-invoice sanathe kulatsidwa.", // REVIEW
    noInvoicesYet:
      "Palibe ma-invoice pakadali pano — zolandira zanu za kulembetsa zidzawoneka kuno.", // REVIEW
    storesCount: "masitolo {count}", // REVIEW
    planWord: "pulani", // REVIEW
    downloadInvoiceAria: "Tsilani invoice {ref}", // REVIEW
    renewExtendTitle: "Ikonzanso kapena kulitsa mapulani anu", // REVIEW
    choosePlanTitle: "Sankhani mapulani", // REVIEW
    choosePlanDesc: "masitolo {count} pa {name}. Sitolo iliyonse ifunika malo olipidwa.", // REVIEW
    yourAccount: "akaunti yanu", // REVIEW: your account
    askAdminRenew: "Funaninso admin kapena manejala kuti akonzerenso kulembetsa.", // REVIEW
    storeSlotsLabel: "Malo a masitolo olembedwa", // REVIEW
    buyExtraSlots: "Gulani malo owonjezera musanawonjezere masitolo.", // REVIEW
    prepaidCreditNote:
      " Nthawi yolipidwa yotsala imawerengedwa pa kuchuluka kwambiri kwa masitolo; tsiku lanu lothera likuwerengedwanso pambuyo pa malipiro.", // REVIEW
    periodMonthly: "Pa mwezi", // REVIEW
    periodYearly: "Pa chaka", // REVIEW
    save15: "Pulumutsani 15%", // REVIEW
    billedYearly: "Kulipidwa chaka chilichonse", // REVIEW
    billedMonthly: "Kulipidwa mwezi uliwonse", // REVIEW
    multiplyPerMonth: "{price} × masitolo {count} / mwezi", // REVIEW
    yearDiscountLine: "Miyezi 12, 15% kuchotsera", // REVIEW
    opening: "Ikutsegula…", // REVIEW
    payAmount: "Lipirani {amount}", // REVIEW
    noCardStored:
      "Storq sikusungira tsatanetsatane wa kadi. Malipiro aliwonse apitilira kudzera pa PayChangu.", // REVIEW
    mobileMoneyTitle: "Airtel Money / TNM Mpamba",
    mobileMoneyDesc: "Lipirani kuchokera ku wallet ya mobile money panthawi yolipira.", // REVIEW
    cardTitle: "Kadi ya debit / credit", // REVIEW
    cardDesc: "Visa ndi Mastercard kudzera pa popup yotetezeka ya PayChangu.", // REVIEW
    lastPaidLine: "Zinalipidwa {date} ndi {amount}.", // REVIEW
    paySetupPlan: "Lipirani & konzani mapulani", // REVIEW
    invTitle: "Invoice ya kulembetsa", // REVIEW
    invSubtitle: "Invoice {ref}",
    invPlan: "Mapulani", // REVIEW: plan
    totalPaid: "Zonse zolipidwa", // REVIEW: total paid
    invoicePdfError: "Sanathe kupanga PDF ya invoice.", // REVIEW
    badgePaid: "ZALIPIDWA", // REVIEW
    billedTo: "Yalipidira", // REVIEW: billed to
    invoiceDate: "Tsiku la invoice", // REVIEW
    currencyWord: "Ndalama", // REVIEW: currency
    thDescription: "Fotokozero", // REVIEW
    thStores: "Masitolo",
    thAmount: "Mlingo",
    invPlanLine: "{period} · masitolo {count}", // REVIEW
    invLineDesc: "Kulembetsa kwa Storq POS {period}", // REVIEW
    yearlyDiscountSuffix: " (15% kuchotsera kwa chaka kwagwiritsidwa)", // REVIEW
    invFooter: "Zalipidwa kudzera pa PayChangu. Zikomo kugwiritsa ntchito Storq.", // REVIEW
    paymentReceived: "Malipiro alandirwa — zikomo!", // REVIEW
    payNotConfigured: "Malipiro sakonzedwebekabe.", // REVIEW
    paychanguFailed: "PayChangu sanathe kutsegulika. Chonde yesaninso.", // REVIEW
  },
  marketing: {
    navShops: "Zili Za Ndani", // REVIEW: who it's for
    navFeatures: "Zomwe Mumapeza",
    navLayby: "Ngongole",
    navPricing: "Mitengo",
    logIn: "Lowani",
    trial: "Yambani Kuyesa Kwaulere", // REVIEW: start free trial
    seeHow: "Onani Momwe Imagwirira Ntchito",
    heroEyebrow: "Yomangidwira Ma Duka a ku Africa", // REVIEW
    heroH1: "Dziwani Zomwe Duka Lanu Lipanga. Tsiku Lililonse.", // REVIEW
    heroLead:
      "Storq imayang'anira Kugulitsa, katundu ndi ogwira ntchito pa foni yomwe ili nanu m'thumba — kotero mumaleka kuganizira kumene ndalama zipita.", // REVIEW
    heroNote: "Palibe kadi. Palibe zida zatsopano. Kugulitsa m'mphindi 5.", // REVIEW
    heroTakings: "Zolowa Lero · Duka la Limbe", // REVIEW
    heroTrend: "▲ 24% poyerekeza Lachitatu Lapitalo", // REVIEW
    shopsH2: "Yopangidwira Ma Duka Monga Lane", // REVIEW
    shopsLead:
      "Kugulitsa kumodzi lero, ma nthambi atatu chaka chamawa. Zovala, zakudya, zida zomangira kapena pang'ono pa zonse — Storq imakwanirana ndi momwe mumakadalirani.", // REVIEW
    shopClothing: "Zovala & Mafashoni",
    shopClothingNote: "Kukula ndi mtundu lililonse liwerengedwa — palibe chogulitsidwa chosapezeka", // REVIEW
    shopGrocery: "Zakudya & Spaza",
    shopGroceryNote: "Malonda ang'onoang'ono ambiri, ogulitsidwa popandina mizere", // REVIEW
    shopHardware: "Zida Zomangira & Mango",
    shopHardwareNote: "Malonda akuluakulu amene adikira chilolezo chanu", // REVIEW
    shopBetween: "Duka Lililonse Lina", // REVIEW
    shopBetweenNote: "Ngati chimagulitsa, chidzakhala pa foni yanu lero usiku", // REVIEW
    counterEyebrow: "Pa Kugulitsa",
    counterH2: "Gulitsani mu kugwira katatu.", // REVIEW
    counterLead:
      "Makasitomala alipira momwe akufunira, zinthu zimachoka pa guwa zokhazi, ndipo risidi ili m'dzanze musanatembenuke.", // REVIEW
    counter1: "Ndalama, kadi, Airtel Money kapena TNM Mpamba — batani limodzi pa iliyonse", // REVIEW
    counter2: "Katundu umachepera pompopompo pakagulitsidwa, pa chipangizo chilichonse", // REVIEW
    counter3: "Malonda onse ali ndi dzina la wolandila yemene anawagulitsa", // REVIEW
    controlH2: "Yang'anirani Duka popanda kugona pa Kugulitsa.", // REVIEW
    controlLead:
      "Munthu aliyense, kwacha iliyonse ndi gawo lililonse la katundu zisiya njira. Njira imeneyi ndi imene imakulolani kuti mutseke 6 ndipo mukhale ndi chikhulupiriro pa ziwerengero m'mawa.", // REVIEW
    controlPin: "PIN ya Munthu Aliyense",
    controlPinDesc:
      "Lowani kamodzi pa chipangizo, kenako wolandila aliyense amatsegula Kugulitsa ndi nambala yawo. Malonda, zotsegula ndi zobwezeredwa zili ndi dzina — lawo.", // REVIEW
    controlOk: "Malonda Akulu adikira OK Yanu",
    controlOkDesc:
      "Pa masitolo amene mwasankha, wolandila alembedwa invoice ndipo palibe chochoka pa guwa mpaka mtsogoleri wanena inde. Yopangidwira zakuchitenge ndi zinthu zamtengo wapatali.", // REVIEW
    controlStock: "Katundu sawathawa popanda kuonanso", // REVIEW
    controlStockDesc:
      "Kugulitsa, kusamutsa, kubweza kapena kuwerengera: kayendedwe lilikonse lembetsa ndi chifukwa ndi munthu amene linachita. Zosowa zisiyake kukhala mwambe.", // REVIEW
    stockEyebrow: "Katundu Wanu",
    stockH2: "Musataye gulitsa chifukwa 'satha'.", // REVIEW
    stockLead:
      "Onani zili pa guwa m'duka lililonse, zikhala kwanthawi yayitali ndi zatha masikono — makasitomala sanafunse.", // REVIEW
    stockSells: "Zogulitsa",
    stockSellsDesc: "ndi zokhala — zosunthidwa ndi malonda onse", // REVIEW
    stockLow: "Zikuchepetsa",
    stockLowDesc: "zilembedwa chogulitsa kwambiri chisanathe", // REVIEW
    laybyEyebrow: "Ngongole",
    laybyH2: "Sinthani 'Ndalipira mwezi wamawa' kukhala ndalama lero.", // REVIEW
    laybyLead:
      "Landirani ndalama zoyamba, sungani zinthu ndipo leverengani malipiro onse akafika. Makasitomala apita chimwemwe, malonda ndi anu, ndipo sipadzakhala mkangano pa zolipidwa.", // REVIEW
    laybyRef: "Ngongole #1042 · Thandi M.",
    laybyItem: "Seti ya Sofeti — MK 9 600", // REVIEW
    laybyOnTrack: "Pa njira yabwino", // REVIEW
    laybyPaid: "MK 5 950 zalipidwa",
    laybyLeft: "MK 3 650 zatsala",
    laybyDeposit: "Ndalama Zoyamba · Ndalama", // REVIEW
    laybyMobile: "Ndalama pa foni",
    laybyCard: "Kadi",
    storyEyebrow: "Eni Maduka",
    storyQuote:
      '"Ndimatseka duka ndisanadziwe ngati tapeza ndalama. Tsopano ndimaona pa foni yanga, osati pa bokosi la ndalama — ndipo zonse zili pa iyo zili ndi dzina kumbuyo kwazo."', // REVIEW
    storyRole: "Bwenzi la duka la zovala, Limbe", // REVIEW
    storyStat1: "malonda anu oyamba asanachitike", // REVIEW
    storyStat2: "zida zowonjezera zogula", // REVIEW
    storyStat3: "andalama, kadi ndi ndalama pa foni", // REVIEW
    insideEyebrow: "Zina Zomwe Zili Mkati", // REVIEW
    insideH2: "Zonse zina zomwe mumangosunga m'buku.", // REVIEW
    inside1: "Dziwani Masiku Anu Abwino",
    inside1Desc:
      "Onani zomwe zimagulitsa, zokhala ndi zomwe mwatsala pambuyo pa zotulutsa — tsiku, kugulitsa ndi duka.", // REVIEW
    inside2: "Tsegulani Kugulitsa Kachiwiri", // REVIEW
    inside2Desc:
      "Onjezani counter kapena nthambi lonse ndipo katundu, ogwira ntchito ndi zolowa zikubwera kumalo kumodzi.", // REVIEW
    inside3: "Sunthani Katundu Pakati pa Maduka",
    inside3Desc:
      "Tengani zinthu kuchokera ku nthambi yosewera kupita ku yopanda phokoso popanda kutaya kuona aliyense.", // REVIEW
    inside4: "Duka Lanu m'Thumba Lanu",
    inside4Desc: "Onani zolowa lero kuchokera kunyumba, pa basi, kapena imani mu duka lina.", // REVIEW
    inside5: "Imagulitsa ngakhale data yatha", // REVIEW
    inside5Desc:
      "Kugulitsa kumanga malonda pa chipangizo ndikuulembetsa nthawi yomwe network yabweerera.", // REVIEW
    inside6: "Risidi Zomwe Zinafana Nanu",
    inside6Desc:
      "Risidi yosindikizidwa kapena yotumizidwa ndi dzina la duka lanu — chimene makasitomala amabweerera nacho.", // REVIEW
    startH2: "Kuchokera kulembetsa kufika malonda oyamba, lero.", // REVIEW
    start1: "Tsegulani Akaunti Yanu",
    start1Desc:
      "Tcheni bizinesi ndi duka lanu. Palibe kadi, palibe kudikira — kuyesa kumayamba mukalembetsa.", // REVIEW
    start2: "Ikani Zinthu Zanu",
    start2Desc: "Lembani zomwe mukulitsa, mtengo wazo ndi zili pa guwa. Zinthu 5 kapena 5,000.", // REVIEW
    start3: "Yambani Kugulitsa",
    start3Desc:
      "Tsegulani Kugulitsa pa foni kapena laptop iliyonse ndipo gulitsani malonda oyamba tsiku lisanathe.", // REVIEW
    pricingH2: "Ndondomeko Imodzi. Lipira pa Duka.", // REVIEW
    pricingLead:
      "Palibe chobisika kwa ndondomeko imene sunagulidwe, ndipo palibe gawo lina logulitsidwa mtsogomo. Mumulipira duka lililonse limene mumayang'anira — ndipo kuyesa kwa ulere kumabwera nako.", // REVIEW
    pricingCardTitle: "Ndondomeko Imodzi — zonse zili mkati", // REVIEW
    pricingTrialBadge: "Kuyesa kwa Ulaya Kuli Mkati", // REVIEW
    pricingPerStore: "/duka /mwezi",
    pricingNote:
      "Kugulitsa kumodzi kapena 6 — mulipira pa duka lililonse lomwe mutsegula, mwezi uliwonse. Lipirani chaka ndipo songosani 15%, ndi Airtel Money, TNM Mpamba kapena kadi.", // REVIEW
    pricingFoot:
      "Kuyesa kumakuphimbira duka limodzi ndi ma PIN a ogwira ntchito mpaka 3. Palibe kadi yofunikira kuyamba.", // REVIEW
    feat1: "Malonda onse, risidi ndi malipoti a Kugulitsa", // REVIEW
    feat2: "Ngongole, malonda a ngongole ndi zobweza", // REVIEW
    feat3: "Katundu wamoyo m'duka lililonse limene mumayang'anira", // REVIEW
    feat4: "PIN ndi udindo pa Munthu Aliyense",
    feat5: "Zogulitsa, zochepa, ndi zotsala pambuyo pa zotulutsa", // REVIEW
    feat6: "Kuwerengera katundu kodza gulu lonse pa mafoni awo", // REVIEW
    closeH2: "Dziwani zomwe lero lapanga, musatseke chitseko.", // REVIEW
    closeFoot: "Kuyesa kwa ulere pa duka lanu loyamba · Palibe kadi · Litsani mukangolitsa", // REVIEW
    footerTag: "Kugulitsa Lanu · Katundu Wanu · Ogwira Ntchito Anu", // REVIEW
    faqH2: "Mafunso Omene Eni Maduka Amafunsa", // REVIEW
    faq1Q: "Zimawononga Ndalama Zingati?", // REVIEW
    faq1A:
      "MK{price} pa mwezi ku duka lililonse limene mumayang'anira — ndiyo ndondomeko yonse, ndi mfundo zonse zili mkati. Duka lanu loyamba limayang'anira kwaulere pa kuyesa, ndipo mulipira ndi Airtel Money, TNM Mpamba kapena kadi.", // REVIEW
    faq2Q: "Kodi ndifunika kugula zida?", // REVIEW
    faq2A:
      "Ayi. Storq imagwira ntchito mu browser pa foni ya Android, tablet kapena laptop imene muli nayo kale — palibe makina a Kugulitsa, palibe chida cha barcode, ndipo imawala zokwanira kugwira ntchito pa data yodziwika.", // REVIEW
    faq3Q: "Kodi Ogwira Ntchito Anga Angaone Ndalama Zanga?", // REVIEW
    faq3A:
      "Zokha zomwe muloletsa. Munthu aliyense amatsegula Kugulitsa ndi PIN yawo ya manambala 4, ndipo PIN imeneyi imasankha zomwe angachite: olandila amagulitsa, atsogoleri amavomereza, ndipo zotulutsa ndi malipoti zikhalira nanu.", // REVIEW
    faq4Q: "Kodi chichitika chiyani interineti ikangozima?", // REVIEW
    faq4A:
      "Pa Kugulitsa kogulitsa mwachindunji counter imapitiriza kugwira ntchito — malonda amangokhalira pa chipangizo ndipo adziulembetsa nthawi yomwe intaneti yabweerera, kotero kuti kuzima kosakanika kasitomala.", // REVIEW
    faq5Q: "Kodi Ndingayang'anire Maduka Anosiyana?", // REVIEW
    faq5A:
      "Inde. Onjezani duka tsiku lomwe mutsegule. Lililonse limasunga katundu ndi ogwira ntchito lace, ndipo muona zonse kuchokera pa foni imodzi.", // REVIEW
    faq6Q: "Kodi Makasitomala Anga Angalipire Momwe Akufunira?", // REVIEW
    faq6A:
      "Ndalama, kadi, Airtel Money kapena TNM Mpamba — zolandirwa pa counter ndiponso pa lipiro lililonse la ngongole, kotero kuti bokosi la ndalama limagwilizana nthawi zonse ndi zomwe tsiku lagulitsa.", // REVIEW
  },
};
