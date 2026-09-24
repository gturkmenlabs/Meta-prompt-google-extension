# Claude Code Komut İstem (Prompt) Üretici ve Yönetim Sistemi

Bu sistem, Anthropic'in otonom kodlama ajanı **Claude Code**'un tüm komutlarını, bayraklarını ve çalışma modlarını maksimum verim, minimum token harcaması ve sıfır hata ile yönlendirmeniz için tasarlanmış profesyonel istem şablonları kataloğudur.

---

## 1. Altın Prompt Mimarisi (4 Temel Yapı Taşı)

Etkili bir Claude Code istemi her zaman şu 4 bileşeni içermelidir:

```markdown
1. KAPSAM & ROL  : [Kod dizini / Modül] + [Görevin amacı]
2. ADIMLAR       : İlerleme sırası (Örn: Önce Keşfet -> Plan Sun -> Onay Bekle -> Kodla)
3. KISITLAR      : Nelerin YAPILMAMASI gerektiği (Do Not listesi)
4. DOĞRULAMA     : Görevin tamamlandığını kanıtlayacak test/komut kriteri
```

---

## 2. Kategoriye Göre Hazır Komut İstem Şablonları

### A. Proje Başlangıcı ve Keşif (Onboarding & Analysis)

#### `/init` — Proje İskeleti ve CLAUDE.md Üretimi
* **Amacı**: Kod tabanını tarayarak projenin `CLAUDE.md` rehber dosyasını otomatik oluşturur.
* **Optimum İstem Şablonu**:
```text
/init

Proje kök dizinindeki tüm mimariyi, paket yöneticisini, build/test komutlarını ve klasör yapısını analiz et.
Üreteceğin CLAUDE.md dosyasını 200 satırın altında tut. Genel geçer kodlama tavsiyeleri ekleme; yalnızca bu projeye özgü derleme komutları, test çalıştırma adımları ve mimari kuralları ekle.
```

#### `/doctor` (`/checkup`) — Kurulum ve Sistem İyileştirme
* **Amacı**: Ortam ayarlarını, gereksiz yüklenen skill/MCP sunucularını ve bayatlayan kuralları denetler.
* **Optimum İstem Şablonu**:
```text
/doctor

Sistem yapılandırmamı, yüklü MCP sunucularını ve CLAUDE.md dosyalarımı tarayarak bağlam ısrafına yol açan noktaları tespit et. Önerilen temizlik ve optimizasyon adımlarını listele ve onayımı alarak uygula.
```

---

### B. Mimari Tasarım ve Planlama (Planning & Design)

#### `/plan` (veya `Shift+Tab`) — Salt Okunur Plan Modu
* **Amacı**: Kodda herhangi bir değişiklik yapmadan önce dosyaları inceleyip adım adım uygulama planı çıkartır.
* **Optimum İstem Şablonu**:
```text
/plan [Görevin Özeti]

Lütfen aşağıdaki adımları sırayla izle:
1. İlgili bileşenleri, veri modellerini ve bağımlı dosyaları oku (@ile_referans_dosya).
2. Değişikliğin geriye dönük uyumluluğunu ve olası yan etkilerini değerlendir.
3. Uygulama adımlarını `planning.md` dosyasına yaz ve netleştirilmesi gereken soruların varsa sor.
4. Ben planı onaylamadan kod yazma veya dosya değiştirme.
```

---

### C. Kodlama, İnceleme ve Doğrulama (Execution & Quality)

#### `/review` (`/code-review`) — Kod ve Güvenlik İncelemesi
* **Amacı**: Değişiklikleri mantık hataları, performans ve güvenlik açısından inceler.
* **Optimum İstem Şablonu**:
```text
/review --fix

Mevcut diff'i incele. Yalnızca mantık hataları, tip uyumsuzlukları ve güvenlik açıklarına odaklan. Stilistik önerileri atla. Tespit ettiğin hataları otomatik düzelt ve yapılan düzeltmelerin testlerini çalıştır.
```

#### `/goal` — Hedef Odaklı Otonom Çalışma
* **Amacı**: Belirlenen başarı kriteri sağlanana kadar Claude Code'un otonom döngüde çalışmasını sağlar.
* **Optimum İstem Şablonu**:
```text
/goal "Tüm birim testleri geçene ve linter sıfır hata verene kadar devam et"

Sorunlu modülü analiz et, hatayı tespit et, düzeltmeyi yap ve `npm test` komutunu çalıştır. Testler başarısız olursa çıktıyı okuyup hatayı kendi kendine düzeltmeye devam et.
```

#### `/simplify` — Kod Temizleme ve Sadeleştirme
* **Amacı**: Karmaşıklaşan kodu işlevselliği bozmadan sadeleştirir.
* **Optimum İstem Şablonu**:
```text
/simplify @src/services/auth.ts

Bu dosyadaki karmaşıklığı azalt. İç içe geçmiş koşullu ifadeleri sadeleştir, gereksiz soyutlamaları kaldır ve okunabilirliği artır. Kod davranışını ve mevcut testlerin durumunu koru.
```

---

### D. Bağlam ve Token Yönetimi (Context & Memory)

#### `/compact` — Odaklı Bağlam Özetleme
* **Amacı**: Konuşma geçmişini belirli bir konuya odaklanarak sıkıştırır.
* **Optimum İstem Şablonu**:
```text
/compact Focus on the database schema changes and API response standards

Şu ana kadarki kararları ve yapılan dosya değişikliklerini özetle; eski hata çıktılarını ve ilgisiz tartışmaları hafızadan temizle.
```

#### `/btw` — Bağlamı Kirletmeyen Yan Soru
* **Amacı**: Ana sohbet geçmişine girmeden hızlı bilgi sorgulaması yapar.
* **Optimum İstem Şablonu**:
```text
/btw [Soru]

Örnek: /btw Bu projedeki kullanıcı kimlik doğrulama çerezlerinin (cookies) geçerlilik süresi kaç saat ayarlanmıştı?
```

---

### E. Paralel Çalışma ve Otomasyon (Parallelism & Automation)

#### `claude -w` (`--worktree`) — Git Worktree İzolasyonu
* **Amacı**: Ayrı bir Git worktree açarak ana kodu bozmadan izole çalışmayı sağlar.
* **Optimum İstem Şablonu**:
```bash
# Terminalden Çalıştırma:
claude -w feature-auth "Auth modülünü JWT kullanacak şekilde yeniden yapılandır"
```

#### `/batch` — Büyük Değişiklikleri Paralelleştirme
* **Amacı**: Büyük bir migration veya refactoring işini alt görevlere bölüp paralel worktree'lerde yürütür.
* **Optimum İstem Şablonu**:
```text
/batch Tüm React bileşenlerini Class Component yapısından Functional Component + Hooks yapısına dönüştür. Her bileşeni ayrı bir worktree üzerinde işle ve bağımsız PR'lar oluştur.
```

#### `/loop` — Zamanlanmış ve Tekrarlayan Görevler
* **Amacı**: Arka planda belirli aralıklarla çalışan denetim veya test döngüleri kurar.
* **Optimum İstem Şablonu**:
```text
/loop 10m "npm test komutunu çalıştır, başarısız test varsa hatayı logla ve düzeltme teklifi sun"
```

---

## 3. Komut Önekleri ve Hızlı İpuçları Cheat Sheet

| Önek / Kısayol | Kullanım Amacı | Örnek İstem |
| :--- | :--- | :--- |
| `!` (Ham Bash) | Claude'a sormadan doğrudan terminal komutu çalıştırır | `! npm test` |
| `@` (Dosya Yolu) | İstenen dosyayı arama yapmadan doğrudan bağlama yükler | `@src/index.ts bu dosyayı incele` |
| `Esc Esc` | Kod ve sohbet geçmişini eski kontrol noktasına (checkpoint) geri sarar | `/rewind` |
| `Shift + Tab` | İzin modları arasında hızlıca geçiş yapar | Normal -> Auto -> Plan |
| `--bare` | CLI çağrılarını 10 kat hızlandıran yalın headless mod | `claude --bare -p "Explain README.md"` |

---

## 4. Dinamik Prompt Oluşturucu Akış Mantığı

Herhangi bir görev için Claude Code istemi oluştururken şu adımları izleyin:

1. **Hangi Komut?**: İşi tanımlayın (Yeni Özellik -> `/plan`, Hata Düzeltme -> `/goal`, Temizlik -> `/simplify`, İnceleme -> `/review`).
2. **Bağlamı Sınırla**: Dosyaları açıklamak yerine `@` ile doğrudan gösterin.
3. **Doğrulama Ekle**: Claude'un "yaptım" demesi yerine çalıştıracağı test veya kontrol komutunu ekleyin.
4. **Hafızayı Taza Tut**: Çok aşamalı işlerde %60-70 doluluk oranında `/compact` çalıştırın.
