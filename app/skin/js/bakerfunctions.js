/*
  BAKER FUNCTIONS
*/
function reveal(keys, head, nonce){
  var sopbytes;
  var opOb = {
    "branch": head.hash,
    "contents" : [
        {          
        "kind" : "seed_nonce_revelation",
        "level" : nonce.level,
        "nonce" : nonce.seed
        }
  ]};
    
  /*
    Forge an operation
  */
  return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/forge/operations', opOb)
  .then(function(f)
  { 
    var opbytes = f;
    opOb.protocol = head.protocol;

    // If key stored on a ledger hardware wallet
    if (keys.sk.substr(0,4) !== 'edsk'){
      return window.tezledger.sign(keys.sk, "02"+eztz.utility.buf2hex(eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net))+opbytes).then(function(rr){
        sopbytes = opbytes + rr.signature
        opOb.signature = window.eztz.utility.b58cencode(window.eztz.utility.hex2buf(rr.signature), window.eztz.prefix.edsig);
        return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/operations', [opOb]);
      });
    } 
    else 
    {
      var signed = eztz.crypto.sign(opbytes, keys.sk, eztz.utility.mergebuf(eztz.watermark.endorsement, eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net)));
      // unused? 
      sopbytes = signed.sbytes;
      //var oh = eztz.utility.b58cencode(eztz.library.sodium.crypto_generichash(32, eztz.utility.hex2buf(sopbytes)), eztz.prefix.o);
      opOb.signature = signed.edsig;
      return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/operations', [opOb]);
    }
  })
  .then(function(f)
  {
    return eztz.node.query('/injection/operation', sopbytes);
  })
  .then(function(f)
  {
    logOutput("!Nonce has been revealed for level " + nonce.level);
    nonce.revealed = true;
    //addNonce(nonce);
    return f
  }).catch(function(e)
  {
    logOutput("!Couldn't reveal nonce for " + nonce.level);
    logOutput(e)
    addNonce(nonce);
  });
}

function endorse(keys, head, slots){
  var sopbytes;
  var opOb = {
      "branch": head.hash,
      "contents" : [
        {          
          "kind" : "endorsement",
          "level" : head.header.level,
        }
    ]};

  return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/forge/operations', opOb)
  .then(function(f)
  {
    var opbytes = f;
    opOb.protocol = head.protocol;
    if (keys.sk.substr(0,4) != 'edsk')
    {
      return window.tezledger.sign(keys.sk, "02"+eztz.utility.buf2hex(eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net))+opbytes).then(function(rr)
      {
        sopbytes = opbytes + rr.signature
        opOb.signature = window.eztz.utility.b58cencode(window.eztz.utility.hex2buf(rr.signature), window.eztz.prefix.edsig);
        return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/operations', [opOb]);
      });
    } 
    else 
    {
      var signed = eztz.crypto.sign(opbytes, keys.sk, eztz.utility.mergebuf(eztz.watermark.endorsement, eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net)));
      sopbytes = signed.sbytes;
      // unused?
      //var oh = eztz.utility.b58cencode(eztz.library.sodium.crypto_generichash(32, eztz.utility.hex2buf(sopbytes)), eztz.prefix.o);
      opOb.signature = signed.edsig;
      return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/operations', [opOb]);
    }
  })
  .then(function(f)
  {
    return eztz.node.query('/injection/operation', sopbytes);
  })
  .then(function(f)
  {
    return f;
  })
  .catch(function(e){logOutput(e)});
}

function bake(keys, head, priority, timestamp)
{
  var operations = [[],[],[],[]],
  seed = '',
  seed_hex = '',
  nonce_hash = '',
  newLevel = head.header.level+1;
    
  if ((newLevel) % (window.CONSTANTS.commitment) === 0){
    var seed = eztz.utility.hexNonce(64),
    seed_hash = eztz.library.sodium.crypto_generichash(32, eztz.utility.hex2buf(seed));
    nonce_hash = eztz.utility.b58cencode(seed_hash, eztz.prefix.nce);
    seed_hex = eztz.utility.buf2hex(seed_hash);
    logOutput("Nonce required for level " + newLevel);
  }
    
  return eztz.node.query('/chains/'+head.chain_id+'/'+window.CONSTANTS.mempool).then(function(r)
  {
    var addedOps = [];
    for(var i = 0; i < r.applied.length; i++)
    {
      if (addedOps.indexOf(r.applied[i].hash) <0) 
      {
        if (r.applied[i].branch !== head.hash) continue;
        if (badOps.indexOf(r.applied[i].hash) >= 0) continue;
        if (operationPass(r.applied[i]) === 3) continue;//todo fee filter

        addedOps.push(r.applied[i].hash);
        operations[operationPass(r.applied[i])].push({
          "protocol" : head.protocol,
          "branch" : r.applied[i].branch,
          "contents" : r.applied[i].contents,
          "signature" : r.applied[i].signature
        });
      }
    }

    var header = {
        "protocol_data": {
          protocol : head.protocol,
          priority : priority,
          proof_of_work_nonce : "0000000000000000",
          signature : "edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q"
        },
        "operations": operations
    };

    if (nonce_hash !== "") header.protocol_data.seed_nonce_hash = nonce_hash;

    /*
      Simulate the validation of a block that would contain the given operations and return the resulting fitness and context hash.
    */
    return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/block?sort=true&timestamp='+Math.max(dateToTime(getDateNow()), dateToTime(timestamp)), header)
    .then(function(r)
    {
      // Preapply succeeded. Returning response.
      return r;
    }).catch(function(e)
    {
      console.error("Preapply failed", e);
      logOutput("!Couldn't bake - send 0 op bake instead");
      header.operations = [[],[],[],[]];
      return eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/preapply/block?sort=true&timestamp='+Math.max(dateToTime(getDateNow()), dateToTime(timestamp)), header);
    });
  }).then(function(preApplyResponse)
  {
    logOutput("!Starting POW...");
    var shell_header = preApplyResponse.shell_header, operations = preApplyResponse.operations;
    
    return new Promise(function(resolve, reject) 
    {
      shell_header['protocol_data'] = createProtocolData(priority);
      ops = [];
      for(var i = 0; i < operations.length; i++)
      {
        var oo = [];
        for(var ii = 0; ii < operations[i].applied.length; ii++)
        {
          oo.push(
          {
            branch : operations[i].applied[ii].branch,
            data : operations[i].applied[ii].data,
          });
        }

        ops.push(oo);
      }

      operations = ops;
        
      /*
        Forge a block header
      */
      eztz.node.query('/chains/'+head.chain_id+'/blocks/'+head.hash+'/helpers/forge_block_header', shell_header).then(function(r)
      {
        var forged = r.block, signed, sopbytes;
        forged = forged.substring(0, forged.length - 22);
        var start = new Date().getTime();
        powLoop(forged, priority, seed_hex, function(blockbytes, att)
        {
          var secs = ((new Date().getTime() - start)/1000).toFixed(3);
          logOutput("+POW found in " + att + " attemps (" + secs + " seconds - "+(att/secs)/1000+"Kh/s)");

          // If keys are stored on a Ledger, sign transaction with hardware wallet.
          if (keys.sk.substr(0,4) !== 'edsk')
          {
            window.tezledger.sign(keys.sk, "01"+eztz.utility.buf2hex(eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net))+blockbytes).then(function(rr)
            {
              sopbytes = blockbytes + rr.signature
              resolve({
                data : sopbytes,
                operations : operations,
              });
            });
          } 
          else 
          {
            signed = eztz.crypto.sign(blockbytes, keys.sk, eztz.utility.mergebuf(eztz.watermark.block, eztz.utility.b58cdecode(head.chain_id, eztz.prefix.Net)));
            sopbytes = signed.sbytes;
            resolve({
              data : sopbytes,
              operations : operations,
            });
          }
        });
      });
    });
  }).then(function(signResult){
    return {
      timestamp : timestamp,
      data : signResult,
      seed_nonce_hash : seed_hex,
      seed : seed,
      level : newLevel,
      chain_id : head.chain_id
    };
  });
}