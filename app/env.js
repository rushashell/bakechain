var VERSION = '3.1.0',
NODE_URL = 'https://api.tezos.id',
API_URL = 'https://api.tzstats.com/',
EXPLORER_ACCOUNTINFO_URL = "https://tzstats.com/{PKH}",
EXPLORER_BLOCKINFO_URL = "https://tzstats.com/{BLOCKHASH}",
DEBUGMODE = true,
BAKECHAIN_POWHEADER = '00bc0303',
CONSTANTS = {
  mempool : 'mempool/pending_operations',
  cycle_length : 4096,
  commitment : 32,
  block_time : 60,
  preserved_cycles: 5,
  blocks_per_roll_snapshot: 256,
  baker_min_staking_balance : 8000000000,
  threshold : 70368744177663,
};
/*
var VERSION = 'zeronet.2.0.0',
NODE_URL = 'https://zeronet.tezrpc.me',
API_URL = 'https://api.zeronet.tzscan.io/v1',
EXPLORER_URL = 'https://zeronet.tzscan.io/',
DEBUGMODE = true,
BAKECHAIN_POWHEADER = '00bc0203',
CONSTANTS = {
  mempool : 'mempool/pending_operations',
  cycle_length : 128,
  commitment : 32,
  block_time : 20,
  threshold : 70368744177663,
};
eztz.node.setDebugMode(true)
eztz.node.setProvider(NODE_URL, true)
//*/
