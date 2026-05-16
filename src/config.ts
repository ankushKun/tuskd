export const TESTNET_CONFIG = {
  suiNetwork: "testnet",
  suiRpcUrl: import.meta.env.VITE_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443",
  walrusPublisher: import.meta.env.VITE_WALRUS_PUBLISHER || "https://publisher.walrus-testnet.walrus.space",
  walrusAggregator: import.meta.env.VITE_WALRUS_AGGREGATOR || "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: import.meta.env.VITE_WALRUS_EPOCHS || "5",
  tuskdPackageId: import.meta.env.VITE_TUSKD_PACKAGE_ID || "",
  tuskdTypePackageId: import.meta.env.VITE_TUSKD_TYPE_PACKAGE_ID || import.meta.env.VITE_TUSKD_PACKAGE_ID || "",
} as const;

export function testnetTxUrl(digest: string) {
  return `https://suiexplorer.com/txblock/${digest}?network=testnet`;
}

export function testnetObjectUrl(objectId: string) {
  return `https://suiexplorer.com/object/${objectId}?network=testnet`;
}
