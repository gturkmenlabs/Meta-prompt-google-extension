# Meta-Prompt Motoru & Revizyon Sistemi 🚀

Bu proje, web sayfalarındaki metin kutularında (input/textarea) yer alan sıradan metinleri, Claude (Anthropic Messages API) veya OpenRouter entegrasyonu sayesinde **uzman düzeyinde prompt'lara (meta-prompt)** yerinde revize eden modern bir Google Chrome uzantısıdır (Manifest V3).

---

## ✨ Özellikler

- **Yerinde Revizyon (In-place Revision)**: Herhangi bir metin kutusundaki metni kısayol tuşuyla doğrudan yerinde geliştirebilirsiniz. Sonuç **akışlı (streaming)** yazılır — metin üretildikçe kutuda belirir.
- **Geri Alma (Undo)**: Yerinde revizyon kutudaki metni ezdiyse `Ctrl + Shift + U` veya sağ tık menüsündeki **"Son revizyonu geri al"** ile orijinal metni geri getirin.
- **Geliştirme Modları**: Standart meta-prompt'a ek olarak **Vibe Coding** (6 strateji), **Web Araştırma** (Boolean/dorking/akademik/OSINT) ve **Anti-Halüsinasyon** (RAG, ReAct, CoN, CoK, LogiCoT, CoVe, Atomik İddia Doğrulama, Öz-Tutarlılık, Semantik Triangülasyon) modları; "Auto" seçiminde strateji metindeki niyete göre otomatik belirlenir.
- **Akıllı Görev Algılama**: Ham metin kodlama / analiz / e-posta / özet / çeviri / açıklama / planlama / yaratıcı yazım olarak sınıflandırılır ve prompt buna göre uzmanlaştırılır.
- **SNN "Ana Beyin" Simülasyonu**: Her revizyondan önce biyofiziksel bir spiking neural network çalışır; ACh/NE/DA nöromodülatör seviyeleri prompt'a bilişsel stil parametresi olarak işlenir ve kullanım geri bildirimiyle (ödül/ceza) zamanla uyarlanır.
- **Çoklu Sağlayıcı Desteği (Anthropic & OpenRouter)**:
  - Doğrudan Anthropic Messages API (Claude Sonnet, Haiku, Opus vb.).
  - OpenRouter API aracılığıyla yüzlerce açık kaynaklı ve ticari model desteği.
- **Akıllı Hata Yönetimi ve Failover**:
  - Bir model meşgul olduğunda veya hata verdiğinde, sıradaki alternatif modele otomatik geçiş (sağlayıcılar arası dahil).
  - 401/403 gibi kritik yetkilendirme hatalarında gereksiz denemeleri durdurma; 90 sn istek / 30 sn akış-sessizlik zaman aşımları.
- **Hızlı Kısayollar**:
  - `Ctrl + Shift + L` (Mac: `Cmd + Shift + L`) — anında yerinde revizyon.
  - `Ctrl + Shift + U` (Mac: `Cmd + Shift + U`) — son revizyonu geri al.
- **Çıktı Kontrolü**: Çıktı dili (Otomatik/Türkçe/İngilizce) ve dört kademeli uzunluk (Kısa/Orta/Uzun/Maks) seçimi.
- **Revizyon Geçmişi**: Son 5 revizyon şifrelenerek yerel olarak saklanır; tek tek silinebilir veya tümü temizlenebilir. API anahtarları/e-postalar geçmişe kaydedilmeden ayıklanır.
- **Güvenli Depolama**: API anahtarlarınız ve tercihleriniz tamamen yerel tarayıcı depolama alanında (`chrome.storage.local`) saklanır; üçüncü taraf sunuculara gönderilmez.

---

## 📂 Proje Yapısı

```text
├── manifest.json          # Chrome Uzantısı yapılandırma dosyası (V3)
├── icons/                 # Uzantı ikonları (SVG kaynağı + 16/32/48/128 PNG)
├── background.js          # Arka plan işçisi (Service Worker), kısayol ve menü dinleyicileri
├── content.js             # Sayfalardaki metin alanlarına erişim sağlayan betik
├── api.js                 # Anthropic ve OpenRouter API entegrasyonları
├── config.js              # Sağlayıcı tanımları ve yerel ayar yönetim yardımcıları
├── popup.html / popup.js  # Hızlı erişim ve durum ekranı arayüzü
├── options.html / options.js # Detaylı model ve API anahtarı ayarları sayfası
├── prompt.js              # Revizyon sistem prompt'ları ve şablonları
├── brain_network.js       # Gelişmiş prompt optimizasyon ağı mantığı
├── brain_helper.js        # Yardımcı fonksiyonlar
├── verify_brain.js        # SNN doğrulama ve test aracı
├── verify_prompt.js       # Prompt katmanı doğrulama aracı (node verify_prompt.js)
├── compliance.md          # Uumluluk ve standartlar belgesi
├── methodology.md         # Prompt revizyon metodolojisi
└── performance_report.md  # Performans analiz raporu
```

---

## 🛠️ Kurulum ve Yükleme

Uzantıyı yerel olarak tarayıcınıza yüklemek için şu adımları izleyin:

1. Bu depoyu klonlayın veya indirin.
2. Google Chrome tarayıcınızı açın ve `chrome://extensions/` adresine gidin.
3. Sağ üst köşede bulunan **"Geliştirici modu" (Developer mode)** seçeneğini aktif hale getirin.
4. Sol üstteki **"Paketlenmemiş uzantı yükle" (Load unpacked)** butonuna tıklayın.
5. Bu projenin klasörünü (dosyaların bulunduğu ana dizini) seçerek yükleyin.

---

## ⚙️ Yapılandırma ve Kullanım

1. Tarayıcınızın uzantı barından **Meta-Prompt** simgesine tıklayın veya **Seçenekler (Options)** sayfasına gidin.
2. Tercih ettiğiniz sağlayıcıyı (Anthropic ya da OpenRouter) seçin.
3. API anahtarınızı (API Key) girin ve kullanmak istediğiniz modelleri yapılandırın.
4. Herhangi bir web sayfasındaki yazı alanına metninizi yazdıktan sonra:
   - Metni seçip sağ tıklayarak **"Meta-Prompt ile Revize Et"** seçeneğini seçebilir veya
   - `Ctrl + Shift + L` (`Cmd + Shift + L`) kısayolunu kullanabilirsiniz.
5. Sonuç beklediğiniz gibi değilse `Ctrl + Shift + U` (`Cmd + Shift + U`) ile orijinal metni geri getirebilirsiniz.
