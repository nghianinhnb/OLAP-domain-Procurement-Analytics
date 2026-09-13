import { runPurchaseOrderValidator } from './consumers/purchase-order.consumer';
// import { runGoodsReceiptValidator } from './consumers/goods-receipt.consumer';

async function bootstrap() {
  await Promise.all([
    runPurchaseOrderValidator(),
    // runGoodsReceiptValidator(),
  ]);
  // eslint-disable-next-line no-console
  console.log('olap-ingest validators running');
}

bootstrap();
