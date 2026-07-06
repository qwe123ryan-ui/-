// PWA Navigation and i18n Localization Engine
const Navigation = {
  currentPage: 'main',
  history: [],
  
  open(pageId, params = {}) {
    this.history.push(this.currentPage);
    this.currentPage = pageId;
    
    // إخفاء جميع الصفحات
    document.querySelectorAll('.page').forEach(p => {
      p.style.display = 'none';
    });
    
    // إظهار الصفحة المطلوبة داخل نفس الحاوية
    const target = document.getElementById(`page-${pageId}`);
    if (target) {
      target.style.display = 'block';
      target.dataset.params = JSON.stringify(params);
    }
    
    // تحديث حالة الأزرار
    this.updateButtonStates(pageId);
  },
  
  back() {
    if (this.history.length > 0) {
      const prev = this.history.pop();
      this.open(prev);
    }
  },

  updateButtonStates(pageId) {
    console.log('Navigation active page:', pageId);
  }
};

const i18n = {
  en: {
    volume: 'Volume',
    balance: 'Balance',
    start: 'Start',
    stop: 'Stop',
    recording: 'Recording'
  },
  ar: {
    volume: 'الصوت',
    balance: 'التوازن',
    start: 'بدء',
    stop: 'إيقاف',
    recording: 'تسجيل'
  }
};

function setLanguage(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (i18n[lang] && i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
}

// Expose to window for global access
if (typeof window !== 'undefined') {
  window.Navigation = Navigation;
  window.i18n = i18n;
  window.setLanguage = setLanguage;
}
