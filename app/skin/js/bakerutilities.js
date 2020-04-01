function levelToCycle(l){
  return Math.floor((l-1)/window.CONSTANTS.cycle_length);
}

function cycleToLevelStart(c){
  return (c * window.CONSTANTS.cycle_length)+1;
}

function cycleToLevelEnd(c){
  return cycleToLevelStart(c) + window.CONSTANTS.cycle_length - 1;
}
  
  //Utility
  function powLoop(forged, priority, seed_hex, cb){
    var pdd = createProtocolData(priority, window.BAKECHAIN_POWHEADER, '00000000', seed_hex),
    blockbytes = forged + pdd,
    hashBuffer = eztz.utility.hex2buf(blockbytes + "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
    forgedLength = forged.length/2,
    priorityLength = 2,
    powHeaderLength = 4,
    protocolOffset = forgedLength + priorityLength + powHeaderLength,
    powLength = 4,
    syncBatchSize = 2000;
    (function powLoopHelper(att, syncAtt) {
      att++;
      syncAtt++;
      for (var i = powLength-1; i >= 0; i--) {
        if (hashBuffer[protocolOffset+i] == 255) hashBuffer[protocolOffset+i] = 0;
        else {
          hashBuffer[protocolOffset+i]++;
          break;
        }
      }
      if (checkHash(hashBuffer)) {
        var hex = eztz.utility.buf2hex(hashBuffer);
        hex = hex.substr(0, hex.length-128);
        cb(hex, att);
      } else {
        if (syncAtt < syncBatchSize) {
          powLoopHelper(att, syncAtt);
        } else {
          setImmediate(powLoopHelper, att, 0);
        }
      }
    })(0, 0);
  }

  function createProtocolData(priority, powHeader, pow, seed){
    if (typeof seed === "undefined") seed = "";
    if (typeof pow === "undefined") pow = "";
    if (typeof powHeader === "undefined") powHeader = "";
    return priority.toString(16).padStart(4,"0") + 
    powHeader.padEnd(8, "0") + 
    pow.padEnd(8, "0") + 
    (seed ? "ff" + seed.padEnd(64, "0") : "00") +
    '';
  }

  function checkHash(buf){
    rr = eztz.library.sodium.crypto_generichash(32, buf);
    return (stampcheck(rr) <= window.CONSTANTS.threshold);
  }

function stampcheck(s){
  var value = 0;
  for (var i = 0; i < 8; i++) {
      value = (value * 256) + s[i];
  }
  return value;
}

//Utility Functions
function dateToTime(dd) { return (new Date(dd).getTime() / 1000); }

function getDateNow() { return new Date().toISOString().substr(0, 19) + "Z"; }

function operationPass(applied) 
{
  if (applied.contents.length === 1) 
  {
    switch (applied.contents[0].kind) 
    {
      case 'endorsement':
        return 0;
      case 'proposals':
      case 'ballot':
        return 1;
      case 'seed_nonce_revelation':
      case 'double_endorsement_evidence':
      case 'double_baking_evidence':
      case 'activate_account':
        return 2;
      default:
        return 3;
    }
  } 
  else 
  {
    return 3;
  }
}