const FinCloudService = require('./fincloudService');

const service = new FinCloudService({
  apiKey: 'fin-86417488e6552d00a6caad592b71a162'
});

async function run() {
  // Test semua kategori utama
  const categories = ['PULSA', 'KUOTA', 'TOKEN PLN', 'GAMES', 'E-Money', 'SMS & TELP'];
  let allOk = true;

  for (const cat of categories) {
    // Override cache agar fresh fetch selalu terjadi
    delete service._productCache[`${cat}_`];
    delete service._productCacheTime[`${cat}_`];

    const result = await service.getProducts(cat, '');
    const len = result && result.data ? result.data.length : 0;
    const brands = result && result.data ? [...new Set(result.data.map(p => p.brand))].join(', ') : '-';
    const ok = result && result.status === true && len > 0;
    if (!ok) allOk = false;
    console.log(`[${ok ? '✅' : '❌'}] ${cat.padEnd(12)} | ${len} produk | brands: ${brands} | ${result?.msg}`);

    // jeda 3 detik antar kategori agar tidak kena rate limit
    if (categories.indexOf(cat) < categories.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n' + (allOk ? '🎉 SEMUA KATEGORI OK!' : '⚠️ ADA KATEGORI YANG GAGAL — cek log di atas'));
}

run().catch(console.error);
