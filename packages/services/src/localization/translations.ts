/**
 * Translation data for the Localization Service.
 * Provides UI translations and medical term dictionaries for all 10 supported languages.
 * Validates: Requirements 12.1, 12.2, 12.3, 12.6
 */

import type { TranslationDictionary, MedicalTermDictionary } from './localization.types';

/**
 * Default UI translations for common keys across all supported languages.
 * In production, this would be loaded from a database or translation management system.
 */
export const defaultTranslations: TranslationDictionary = {
  'nav.home': {
    en: 'Home',
    hi: 'होम',
    es: 'Inicio',
    zh: '首页',
    ar: 'الرئيسية',
    fr: 'Accueil',
    pt: 'Início',
    bn: 'হোম',
    ja: 'ホーム',
    de: 'Startseite',
  },
  'nav.appointments': {
    en: 'Appointments',
    hi: 'अपॉइंटमेंट',
    es: 'Citas',
    zh: '预约',
    ar: 'المواعيد',
    fr: 'Rendez-vous',
    pt: 'Consultas',
    bn: 'অ্যাপয়েন্টমেন্ট',
    ja: '予約',
    de: 'Termine',
  },
  'nav.reports': {
    en: 'Reports',
    hi: 'रिपोर्ट',
    es: 'Informes',
    zh: '报告',
    ar: 'التقارير',
    fr: 'Rapports',
    pt: 'Relatórios',
    bn: 'রিপোর্ট',
    ja: 'レポート',
    de: 'Berichte',
  },
  'nav.notifications': {
    en: 'Notifications',
    hi: 'सूचनाएं',
    es: 'Notificaciones',
    zh: '通知',
    ar: 'الإشعارات',
    fr: 'Notifications',
    pt: 'Notificações',
    bn: 'বিজ্ঞপ্তি',
    ja: '通知',
    de: 'Benachrichtigungen',
  },
  'nav.profile': {
    en: 'Profile',
    hi: 'प्रोफ़ाइल',
    es: 'Perfil',
    zh: '个人资料',
    ar: 'الملف الشخصي',
    fr: 'Profil',
    pt: 'Perfil',
    bn: 'প্রোফাইল',
    ja: 'プロフィール',
    de: 'Profil',
  },
  'nav.billing': {
    en: 'Billing',
    hi: 'बिलिंग',
    es: 'Facturación',
    zh: '账单',
    ar: 'الفواتير',
    fr: 'Facturation',
    pt: 'Faturamento',
    bn: 'বিলিং',
    ja: '請求',
    de: 'Abrechnung',
  },
  'common.submit': {
    en: 'Submit',
    hi: 'जमा करें',
    es: 'Enviar',
    zh: '提交',
    ar: 'إرسال',
    fr: 'Soumettre',
    pt: 'Enviar',
    bn: 'জমা দিন',
    ja: '送信',
    de: 'Absenden',
  },
  'common.cancel': {
    en: 'Cancel',
    hi: 'रद्द करें',
    es: 'Cancelar',
    zh: '取消',
    ar: 'إلغاء',
    fr: 'Annuler',
    pt: 'Cancelar',
    bn: 'বাতিল',
    ja: 'キャンセル',
    de: 'Abbrechen',
  },
  'common.save': {
    en: 'Save',
    hi: 'सहेजें',
    es: 'Guardar',
    zh: '保存',
    ar: 'حفظ',
    fr: 'Enregistrer',
    pt: 'Salvar',
    bn: 'সংরক্ষণ',
    ja: '保存',
    de: 'Speichern',
  },
  'common.loading': {
    en: 'Loading...',
    hi: 'लोड हो रहा है...',
    es: 'Cargando...',
    zh: '加载中...',
    ar: 'جاري التحميل...',
    fr: 'Chargement...',
    pt: 'Carregando...',
    bn: 'লোড হচ্ছে...',
    ja: '読み込み中...',
    de: 'Wird geladen...',
  },
  'notification.appointment_confirmed': {
    en: 'Your appointment has been confirmed for {date}.',
    hi: 'आपकी अपॉइंटमेंट {date} के लिए पुष्टि हो गई है।',
    es: 'Su cita ha sido confirmada para el {date}.',
    zh: '您的预约已确认，日期为 {date}。',
    ar: 'تم تأكيد موعدك في {date}.',
    fr: 'Votre rendez-vous a été confirmé pour le {date}.',
    pt: 'Sua consulta foi confirmada para {date}.',
    bn: 'আপনার অ্যাপয়েন্টমেন্ট {date} তারিখে নিশ্চিত হয়েছে।',
    ja: '{date}の予約が確認されました。',
    de: 'Ihr Termin wurde für den {date} bestätigt.',
  },
  'notification.report_available': {
    en: 'Your health report is now available for review.',
    hi: 'आपकी स्वास्थ्य रिपोर्ट अब समीक्षा के लिए उपलब्ध है।',
    es: 'Su informe de salud está disponible para revisión.',
    zh: '您的健康报告现在可以查看了。',
    ar: 'تقريرك الصحي متاح الآن للمراجعة.',
    fr: 'Votre rapport de santé est maintenant disponible.',
    pt: 'Seu relatório de saúde está disponível para revisão.',
    bn: 'আপনার স্বাস্থ্য রিপোর্ট এখন পর্যালোচনার জন্য উপলব্ধ।',
    ja: '健康レポートが確認可能になりました。',
    de: 'Ihr Gesundheitsbericht steht zur Einsicht bereit.',
  },
  'notification.payment_confirmed': {
    en: 'Payment of {amount} has been successfully processed.',
    hi: '{amount} का भुगतान सफलतापूर्वक संसाधित हो गया है।',
    es: 'El pago de {amount} se ha procesado correctamente.',
    zh: '{amount} 的付款已成功处理。',
    ar: 'تمت معالجة الدفع بمبلغ {amount} بنجاح.',
    fr: 'Le paiement de {amount} a été traité avec succès.',
    pt: 'O pagamento de {amount} foi processado com sucesso.',
    bn: '{amount} এর পেমেন্ট সফলভাবে প্রক্রিয়া করা হয়েছে।',
    ja: '{amount}の支払いが正常に処理されました。',
    de: 'Die Zahlung von {amount} wurde erfolgreich verarbeitet.',
  },
  'notification.reminder': {
    en: 'Reminder: You have an appointment on {date}.',
    hi: 'अनुस्मारक: आपकी {date} को अपॉइंटमेंट है।',
    es: 'Recordatorio: Tiene una cita el {date}.',
    zh: '提醒：您有一个{date}的预约。',
    ar: 'تذكير: لديك موعد في {date}.',
    fr: 'Rappel: Vous avez un rendez-vous le {date}.',
    pt: 'Lembrete: Você tem uma consulta em {date}.',
    bn: 'রিমাইন্ডার: আপনার {date} তারিখে অ্যাপয়েন্টমেন্ট আছে।',
    ja: 'リマインダー：{date}に予約があります。',
    de: 'Erinnerung: Sie haben einen Termin am {date}.',
  },
  'fallback.notice': {
    en: 'This content is displayed in English because a translation is not yet available in your preferred language.',
    hi: 'यह सामग्री अंग्रेजी में प्रदर्शित है क्योंकि आपकी पसंदीदा भाषा में अनुवाद अभी उपलब्ध नहीं है।',
    es: 'Este contenido se muestra en inglés porque la traducción aún no está disponible en su idioma preferido.',
    zh: '此内容以英文显示，因为您的首选语言的翻译尚不可用。',
    ar: 'يتم عرض هذا المحتوى باللغة الإنجليزية لأن الترجمة غير متاحة بعد بلغتك المفضلة.',
    fr: 'Ce contenu est affiché en anglais car la traduction n\'est pas encore disponible dans votre langue.',
    pt: 'Este conteúdo é exibido em inglês porque a tradução ainda não está disponível no seu idioma.',
    bn: 'এই বিষয়বস্তু ইংরেজিতে প্রদর্শিত কারণ আপনার পছন্দের ভাষায় অনুবাদ এখনও উপলব্ধ নয়।',
    ja: 'お使いの言語への翻訳がまだ利用できないため、このコンテンツは英語で表示されています。',
    de: 'Dieser Inhalt wird auf Englisch angezeigt, da eine Übersetzung in Ihrer bevorzugten Sprache noch nicht verfügbar ist.',
  },
  'error.language_switch_failed': {
    en: 'Language change was unsuccessful. The previous language has been retained.',
    hi: 'भाषा परिवर्तन असफल रहा। पिछली भाषा बनी रहेगी।',
    es: 'El cambio de idioma no se realizó. Se mantiene el idioma anterior.',
    zh: '语言切换失败。已保留先前的语言。',
    ar: 'فشل تغيير اللغة. تم الاحتفاظ باللغة السابقة.',
    fr: 'Le changement de langue a échoué. La langue précédente a été conservée.',
    pt: 'A alteração do idioma falhou. O idioma anterior foi mantido.',
    bn: 'ভাষা পরিবর্তন ব্যর্থ হয়েছে। পূর্ববর্তী ভাষা বজায় রাখা হয়েছে।',
    ja: '言語の変更に失敗しました。以前の言語が保持されています。',
    de: 'Die Sprachänderung war nicht erfolgreich. Die vorherige Sprache wurde beibehalten.',
  },
};

/**
 * Medical term dictionary with plain-language explanations.
 * Requirement 12.6: ≤6th-grade reading level.
 */
export const defaultMedicalTerms: MedicalTermDictionary = {
  'blood_pressure': {
    en: {
      translation: 'Blood Pressure',
      explanation: 'The force of blood pushing against the walls of your blood vessels.',
    },
    hi: {
      translation: 'रक्तचाप',
      explanation: 'आपकी रक्त वाहिकाओं की दीवारों पर रक्त का दबाव।',
    },
    es: {
      translation: 'Presión arterial',
      explanation: 'La fuerza de la sangre contra las paredes de los vasos sanguíneos.',
    },
    zh: {
      translation: '血压',
      explanation: '血液对血管壁的压力。',
    },
    ar: {
      translation: 'ضغط الدم',
      explanation: 'قوة دفع الدم على جدران الأوعية الدموية.',
    },
    fr: {
      translation: 'Pression artérielle',
      explanation: 'La force du sang contre les parois des vaisseaux sanguins.',
    },
    pt: {
      translation: 'Pressão arterial',
      explanation: 'A força do sangue contra as paredes dos vasos sanguíneos.',
    },
    bn: {
      translation: 'রক্তচাপ',
      explanation: 'রক্তনালীর দেয়ালে রক্তের চাপ।',
    },
    ja: {
      translation: '血圧',
      explanation: '血管の壁にかかる血液の力。',
    },
    de: {
      translation: 'Blutdruck',
      explanation: 'Die Kraft des Blutes gegen die Wände der Blutgefäße.',
    },
  },
  'cholesterol': {
    en: {
      translation: 'Cholesterol',
      explanation: 'A waxy substance in your blood that can block your blood vessels if too high.',
    },
    hi: {
      translation: 'कोलेस्ट्रॉल',
      explanation: 'आपके रक्त में एक मोमी पदार्थ जो अधिक होने पर रक्त वाहिकाओं को अवरुद्ध कर सकता है।',
    },
    es: {
      translation: 'Colesterol',
      explanation: 'Una sustancia cerosa en la sangre que puede bloquear los vasos si es muy alta.',
    },
    zh: {
      translation: '胆固醇',
      explanation: '血液中的一种蜡状物质，过高时会堵塞血管。',
    },
    ar: {
      translation: 'الكوليسترول',
      explanation: 'مادة شمعية في الدم يمكن أن تسد الأوعية الدموية إذا ارتفعت.',
    },
    fr: {
      translation: 'Cholestérol',
      explanation: 'Une substance cireuse dans le sang qui peut bloquer les vaisseaux si elle est trop élevée.',
    },
    pt: {
      translation: 'Colesterol',
      explanation: 'Uma substância cerosa no sangue que pode bloquear os vasos se estiver alta demais.',
    },
    bn: {
      translation: 'কোলেস্টেরল',
      explanation: 'রক্তে একটি মোমের মতো পদার্থ যা বেশি হলে রক্তনালী বন্ধ করতে পারে।',
    },
    ja: {
      translation: 'コレステロール',
      explanation: '血液中のろう状の物質で、高すぎると血管を詰まらせることがあります。',
    },
    de: {
      translation: 'Cholesterin',
      explanation: 'Eine wachsartige Substanz im Blut, die bei zu hohem Spiegel die Gefäße verstopfen kann.',
    },
  },
  'glucose': {
    en: {
      translation: 'Blood Sugar (Glucose)',
      explanation: 'The amount of sugar in your blood that gives your body energy.',
    },
    hi: {
      translation: 'रक्त शर्करा (ग्लूकोज)',
      explanation: 'आपके रक्त में शर्करा की मात्रा जो आपके शरीर को ऊर्जा देती है।',
    },
    es: {
      translation: 'Azúcar en sangre (Glucosa)',
      explanation: 'La cantidad de azúcar en la sangre que da energía al cuerpo.',
    },
    zh: {
      translation: '血糖（葡萄糖）',
      explanation: '血液中的糖分，为身体提供能量。',
    },
    ar: {
      translation: 'سكر الدم (الجلوكوز)',
      explanation: 'كمية السكر في الدم التي تمنح جسمك الطاقة.',
    },
    fr: {
      translation: 'Glycémie (Glucose)',
      explanation: 'La quantité de sucre dans le sang qui donne de l\'énergie au corps.',
    },
    pt: {
      translation: 'Açúcar no sangue (Glicose)',
      explanation: 'A quantidade de açúcar no sangue que dá energia ao corpo.',
    },
    bn: {
      translation: 'রক্তে শর্করা (গ্লুকোজ)',
      explanation: 'রক্তে চিনির পরিমাণ যা শরীরকে শক্তি দেয়।',
    },
    ja: {
      translation: '血糖値（グルコース）',
      explanation: '体にエネルギーを与える血液中の糖分の量。',
    },
    de: {
      translation: 'Blutzucker (Glukose)',
      explanation: 'Die Menge an Zucker im Blut, die dem Körper Energie gibt.',
    },
  },
  'hemoglobin': {
    en: {
      translation: 'Hemoglobin',
      explanation: 'A protein in red blood cells that carries oxygen to all parts of your body.',
    },
    hi: {
      translation: 'हीमोग्लोबिन',
      explanation: 'लाल रक्त कोशिकाओं में एक प्रोटीन जो आपके शरीर के सभी हिस्सों में ऑक्सीजन पहुंचाता है।',
    },
    es: {
      translation: 'Hemoglobina',
      explanation: 'Una proteína en los glóbulos rojos que lleva oxígeno a todo el cuerpo.',
    },
    zh: {
      translation: '血红蛋白',
      explanation: '红血球中的一种蛋白质，将氧气输送到身体各处。',
    },
    ar: {
      translation: 'الهيموجلوبين',
      explanation: 'بروتين في خلايا الدم الحمراء ينقل الأكسجين إلى جميع أجزاء الجسم.',
    },
    fr: {
      translation: 'Hémoglobine',
      explanation: 'Une protéine dans les globules rouges qui transporte l\'oxygène dans tout le corps.',
    },
    pt: {
      translation: 'Hemoglobina',
      explanation: 'Uma proteína nos glóbulos vermelhos que transporta oxigênio para todo o corpo.',
    },
    bn: {
      translation: 'হিমোগ্লোবিন',
      explanation: 'লাল রক্তকণিকার একটি প্রোটীন যা শরীরের সব অংশে অক্সিজেন বহন করে।',
    },
    ja: {
      translation: 'ヘモグロビン',
      explanation: '赤血球にあるタンパク質で、体のすべての部分に酸素を運びます。',
    },
    de: {
      translation: 'Hämoglobin',
      explanation: 'Ein Protein in roten Blutkörperchen, das Sauerstoff in alle Körperteile transportiert.',
    },
  },
  'ecg': {
    en: {
      translation: 'ECG (Electrocardiogram)',
      explanation: 'A test that checks how your heart beats by measuring its electrical signals.',
    },
    hi: {
      translation: 'ईसीजी (इलेक्ट्रोकार्डियोग्राम)',
      explanation: 'एक परीक्षण जो विद्युत संकेतों को मापकर जांचता है कि आपका दिल कैसे धड़कता है।',
    },
    es: {
      translation: 'ECG (Electrocardiograma)',
      explanation: 'Un examen que revisa cómo late el corazón midiendo sus señales eléctricas.',
    },
    zh: {
      translation: '心电图（ECG）',
      explanation: '通过测量心脏的电信号来检查心跳的测试。',
    },
    ar: {
      translation: 'تخطيط القلب الكهربائي',
      explanation: 'اختبار يفحص كيف ينبض قلبك عن طريق قياس إشاراته الكهربائية.',
    },
    fr: {
      translation: 'ECG (Électrocardiogramme)',
      explanation: 'Un examen qui vérifie les battements du cœur en mesurant ses signaux électriques.',
    },
    pt: {
      translation: 'ECG (Eletrocardiograma)',
      explanation: 'Um exame que verifica como o coração bate medindo seus sinais elétricos.',
    },
    bn: {
      translation: 'ইসিজি (ইলেক্ট্রোকার্ডিওগ্রাম)',
      explanation: 'একটি পরীক্ষা যা বৈদ্যুতিক সংকেত পরিমাপ করে আপনার হৃৎপিণ্ড কীভাবে স্পন্দিত হয় তা পরীক্ষা করে।',
    },
    ja: {
      translation: '心電図（ECG）',
      explanation: '心臓の電気信号を測定して、心臓の鼓動を確認する検査。',
    },
    de: {
      translation: 'EKG (Elektrokardiogramm)',
      explanation: 'Ein Test, der prüft, wie Ihr Herz schlägt, indem er seine elektrischen Signale misst.',
    },
  },
  'bone_density': {
    en: {
      translation: 'Bone Density',
      explanation: 'A measure of how strong and thick your bones are.',
    },
    hi: {
      translation: 'अस्थि घनत्व',
      explanation: 'यह मापता है कि आपकी हड्डियां कितनी मजबूत और मोटी हैं।',
    },
    es: {
      translation: 'Densidad ósea',
      explanation: 'Una medida de qué tan fuertes y gruesos son los huesos.',
    },
    zh: {
      translation: '骨密度',
      explanation: '衡量骨骼强度和厚度的指标。',
    },
    ar: {
      translation: 'كثافة العظام',
      explanation: 'مقياس لمدى قوة وسمك عظامك.',
    },
    fr: {
      translation: 'Densité osseuse',
      explanation: 'Une mesure de la solidité et de l\'épaisseur de vos os.',
    },
    pt: {
      translation: 'Densidade óssea',
      explanation: 'Uma medida de quão fortes e grossos são seus ossos.',
    },
    bn: {
      translation: 'হাড়ের ঘনত্ব',
      explanation: 'আপনার হাড় কতটা শক্তিশালী এবং মোটা তার পরিমাপ।',
    },
    ja: {
      translation: '骨密度',
      explanation: '骨がどれくらい強くて厚いかを測る指標。',
    },
    de: {
      translation: 'Knochendichte',
      explanation: 'Ein Maß dafür, wie stark und dick Ihre Knochen sind.',
    },
  },
};

/**
 * Mapping of SupportedLanguage to BCP 47 locale tags.
 */
export const languageToLocaleTag: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  es: 'es-ES',
  zh: 'zh-CN',
  ar: 'ar-SA',
  fr: 'fr-FR',
  pt: 'pt-BR',
  bn: 'bn-BD',
  ja: 'ja-JP',
  de: 'de-DE',
};
