<p align="right"><a href="README.md">English</a> · <b>Türkçe</b></p>

# MQ Viewer

IBM MQ kuyruklarını görüntülemek ve yönetmek için bir masaüstü uygulaması. Bir queue manager'daki kuyrukları listeleyebilir, mesajları tüketmeden inceleyebilir, tüm MQMD alanlarını ve mesaj özelliklerini okuyabilir, test mesajı gönderebilir, seçili mesajları silebilir ve kuyrukları temizleyebilirsiniz.

![PAYMENTS.IN kuyruğunda bir JSON mesajı açıkken](docs/screenshots/browse.png)

## Özellikler

- **Bağlantılar:** Klasörlerde düzenlenir; her biri DEV, TEST veya PROD olarak ve bir renkle işaretlenir. JSON olarak dışa aktarılıp başka bir makinede içe aktarılabilir. Şifreler dışa aktarılan dosyaya hiçbir zaman yazılmaz.
- **Şifreler işletim sisteminin anahtar zincirinde:** Windows Credential Manager, macOS Keychain veya Linux'ta Secret Service; servis adı `mq-viewer`.
- **TLS:** Cipher spec, PKCS#12/JKS keystore ve truststore, sertifika etiketi ve SSL peer name desteklenir. TLS el sıkışması başarısız olursa sunucunun gönderdiği sertifika zinciri gösterilir.
- **Kuyruk listesi:** Derinlik çubukları (maksimum derinliğin %70'inde sarı, %85'inde kırmızı), açık okuma/yazma bağlantısı sayıları (IPPROCS/OPPROCS), tür filtresi ve `SYSTEM.*` kuyruklarını gizleme.
- **Browse modu:** Kuyruğu okumak mesajları hiçbir zaman silmez. Payload içinde arama (regex dahil), filtreleme ve sayfalama yapılabilir. Otomatik yenileme açıkken yeni gelen mesajlar vurgulanır.
- **Mesaj detayı:** Payload Text, JSON, XML veya Hex olarak görüntülenir. 29 MQMD alanının tamamı sabit adlarıyla (ör. `MQPER_PERSISTENT`), mesaj özellikleriyle birlikte listelenir.
- **Kontrol karakterleri:** İstenirse CR, LF, TAB ile SOH, STX, ETX, NUL gibi ASCII kontrol karakterleri görünür etiketler olarak gösterilir; mesajda hangilerinin bulunduğu da özetlenir.
- **Put message:** Sözdizimi vurgulamalı editör, JSON/XML biçimlendirme ve gövdeyi dosyadan yükleme. MQMD seçenekleri ve mesaj özellikleri ayarlanabilir, aynı anda birden fazla kopya gönderilebilir. Kontrol karakterleri (SOH, STX, ETX…) editörde görünür ve eklenebilir.
- **Gövde şablonları:** Gövdedeki `{{ fn() }}` ifadeleri her kopya için ayrı hesaplanır; böylece N mesajlık bir gönderimde her mesaj farklı ID, sayı ve zaman taşıyabilir. Bkz. [Gövde şablonları](#gövde-şablonları).
- **Drafts:** Hedef kuyruğunu ve bağlantısını hatırlayan, kaydedilmiş örnek mesajlar. Kenar çubuğundan tek tıkla gönderilir.
- **Delete / Purge:** Delete, seçili mesajları MsgId'lerine göre siler. Purge tüm kuyruğu `CLEAR QLOCAL` ile boşaltır; buna izin yoksa mesajları tek tek okuyarak boşaltır. PROD bağlantılarında onay için kuyruk adını yazmak gerekir.
- **Hata ekranları:** MQ hata kodunu (MQRC), olası nedenlerini ve otomatik tekrar denemeye kalan süreyi gösterir.
- Koyu, açık veya sistem teması; `Ctrl+K` ile kuyruk, bağlantı, Draft ve MsgId araması.

## Gövde şablonları

**Send count** 1'den büyükse her kopya ayrı ayrı oluşturulur. İfadeler `{{ isim(argümanlar) }}` biçimindedir; argümanlar sayı ya da `'metin'` olabilir. Yalnızca aşağıdaki fonksiyonlar vardır, hiçbir şey JavaScript olarak çalıştırılmaz. Düz `{{` yazmak için `\{{` kullanın. Şablonlar yalnızca mesaj gövdesinde çalışır; Put penceresindeki **Preview**, oluşacak mesajları göndermeden önce gösterir.

| Fonksiyon | Sonuç |
|---|---|
| `index(start = 1, width = 0)` | Gönderimdeki sıra: start, start+1, …; `width` haneye sıfırla tamamlanır |
| `randomNumber(min = 0, max = 999999)` | Rastgele tam sayı, iki uç dahil |
| `randomDecimal(min = 0, max = 1, digits = 2)` | Sabit haneli rastgele ondalık sayı |
| `randomString(length = 8)` | Rastgele harf ve rakamlar |
| `randomHex(length = 16)` | Rastgele hex haneler |
| `uuid()` | Rastgele UUID v4 |
| `pick(a, b, …)` | Argümanlardan biri |
| `now(format?)` | Varsayılan ISO 8601 (UTC); `yyyy MM dd HH mm ss SSS` ile yerel saat |
| `timestamp()` | Epoch milisaniye |

```json
{
  "id": "{{uuid()}}",
  "seq": {{index()}},
  "ref": "ORD-{{index(1, 6)}}",
  "amount": {{randomDecimal(10, 500, 2)}},
  "currency": "{{pick('EUR', 'USD', 'TRY')}}",
  "createdAt": "{{now()}}"
}
```

## Ekran görüntüleri

| | |
|---|---|
| ![Derinlik çubuklarıyla kuyruk listesi](docs/screenshots/queues.png) | ![Draft yüklenmiş Put message penceresi](docs/screenshots/put-message.png) |
| **Kuyruklar**: derinlik çubukları, IPPROCS/OPPROCS ve "no consumers" uyarıları | **Put message**: JSON editörü, MQMD seçenekleri, özellikler, Draft'lar |
| ![Kontrol karakterleri gösterilen, SOH ayraçlı FIX mesajı](docs/screenshots/control-characters.png) | ![Açık temada MQMD sekmesi](docs/screenshots/browse-light-mqmd.png) |
| **Kontrol karakterleri**: SOH, STX, ETX, CR, LF görünür | **Açık tema**: 29 MQMD alanı sabit adlarıyla |
| ![Başarılı testten sonra bağlantı düzenleme](docs/screenshots/connection.png) | ![PROD bağlantısında adı yazarak onaylanan purge](docs/screenshots/purge.png) |
| **Bağlantı**: test sonucu, anahtar zinciri ve TLS ayarları | **PROD'da purge**: ad eşleşene kadar düğme kapalı kalır |
| ![MQRC 2538 bağlantı hatası kartı](docs/screenshots/error.png) | |
| **Hatalar**: hata kodu, olası nedenler, otomatik tekrar deneme | |

## Kurulum

Platformunuza uygun kurulum paketini [Releases](../../releases) sayfasından indirin:

| Platform | Paket |
|----------|-------|
| Windows | `.msi` veya `-setup.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |
| macOS | `.dmg` |

IBM MQ istemcisi ve bir Java runtime pakete dahildir; başka bir şey kurmanız gerekmez. Uygulama queue manager'lara istemci kanalı (SVRCONN) üzerinden bağlanır, MQ REST API (mqweb) kullanılmaz.

## Mimari

```
┌──────────────── Tauri (Rust) ────────────────┐   satır bazlı JSON      ┌──── Java 21 sidecar ────┐
│ React arayüzü (src/)                         │   stdin/stdout üzerinden│ IBM MQ allclient        │
│ anahtar zinciri, ~/.mq-viewer/*.json, dosya  │ ◄─────────────────────► │ MQI istemci bağlantısı  │
│ diyalogları                                  │                         │ PCF (kuyruk listesi)    │
└──────────────────────────────────────────────┘                         └─────────────────────────┘
```

| Klasör | İçerik |
|--------|--------|
| `src/` | Arayüz: React, TypeScript ve zustand |
| `src-tauri/` | Masaüstü kabuğu. Sidecar sürecini başlatır ve yönetir, kayıtlı şifreleri anahtar zincirinden alıp bağlantıya ekler, yerel JSON dosyalarını okur ve yazar |
| `sidecar/` | MQ işlemleri (`MqOps`), TLS (`TlsFactory`), bağlantı havuzu (`ConnectionPool`) |

Sunucu yoktur; her şey kendi bilgisayarınızda çalışır.

## Yerel veriler

| Konum | İçerik |
|-------|--------|
| `~/.mq-viewer/connections.json` | Bağlantılar (şifresiz) |
| `~/.mq-viewer/settings.json` | Tema, browse limiti, yenileme aralığı, varsayılan CCSID, kontrol karakteri gösterimi |
| `~/.mq-viewer/templates.json` | Draft'lar |
| İşletim sistemi anahtar zinciri, servis `mq-viewer` | `<id>`, `<id>:keystore` ve `<id>:truststore` altında şifreler |

v1'den kalma bir `connections.properties` dosyası varsa, uygulama ilk açıldığında otomatik olarak içe aktarılır.

## Geliştirme

Gereksinimler: Node 22+, Rust (stable) ve JDK 21+. Maven gerekmez; `sidecar/mvnw` kullanılır.

```bash
npm install
npm run sidecar      # sidecar jar'ını ve jlink runtime'ını src-tauri/resources/ altına üretir
npm run tauri dev    # uygulamayı geliştirme modunda açar
```

Yalnızca arayüz üzerinde çalışırken `npm run dev` uygulamayı tarayıcıda, sahte (mock) bir backend ile açar.

Testler:

```bash
cd sidecar && ./mvnw test     # Java birim testleri
cd src-tauri && cargo test    # Rust birim testleri
npm run typecheck
```

Test için yerel bir queue manager:

```bash
docker compose -f docker/mq/docker-compose.yml up -d   # IBM MQ developer edition, QM1
docker/mq/seed.sh                                     # örnek JSON, XML, FIX (SOH) ve STX/ETX mesajları
docker compose -f docker/mq/docker-compose.yml down -v # durdurur ve verisini siler
```

Bağlantı bilgileri: `localhost:1414`, queue manager `QM1`:

| Kanal | Kullanıcı / şifre | Neyi test etmek için |
|---|---|---|
| `DEV.ADMIN.SVRCONN` | `admin` / `passw0rd` | her şey, kuyruk listesi dahil |
| `DEV.APP.SVRCONN` | `app` / `passw0rd` | kısıtlı kullanıcı: PCF ile kuyruk listesi yok, `AUDIT.LOG` yalnızca browse |

`DEV.QUEUE.1-3` dışında `PAYMENTS.IN/OUT`, `ORDERS.IN` (maksimum derinlik 100), `FIX.IN`, `FRAMED.IN`, `AUDIT.LOG`, put'a kapalı `LOCKED.Q` ve `PAYMENTS.API` alias'ı tanımlanır ([docker/mq/20-test-queues.mqsc](docker/mq/20-test-queues.mqsc)). IBM arm64 imajı yayınlamadığı için Apple Silicon'da konteyner amd64 emülasyonuyla çalışır ve biraz daha geç açılır.

> Windows'ta Smart App Control açıkken `cargo build` başarısız olur; Rust'ın derleme zamanı makroları için ürettiği imzasız DLL'leri engeller.

## Paketleme

```bash
npm run tauri build
```

Windows'ta MSI ve NSIS kurulum paketleri `src-tauri/target/release/bundle/` altına üretilir. Bir `v*` etiketi push edildiğinde `.github/workflows/release.yml` çalışır; Windows, Linux ve macOS paketlerini üretip GitHub Release'e ekler.

## Lisans

MIT
