function initBCBaker() 
{
  function loadNonces()
  {
    noncesToReveal = window.store2.get('bknonces', []);
  };

  function addNonce(n)
  {
    noncesToReveal.push(n);
    window.store2.set('bknonces', noncesToReveal);
  }

  function revealNonces(keys, head)
  {
    var newNonces = [];
    for (var i = 0; i < noncesToReveal.length; i++) 
    {
      var startReveal = cycleToLevelStart(levelToCycle(noncesToReveal[i].level)+1);
      var endReveal = cycleToLevelEnd(levelToCycle(noncesToReveal[i].level)+1);
      if (head.header.level > endReveal) {
        logOutput("!Abandon nonce " + noncesToReveal[i].seed + " for level " + noncesToReveal[i].level);
        continue;
      } else if (head.header.level >= startReveal && noncesToReveal[i].revealed == false) {
        logOutput("!Revealing nonce " + noncesToReveal[i].seed + " for level " + noncesToReveal[i].level);
        reveal(keys, head, noncesToReveal[i]);
        continue;
      } else
      newNonces.push(noncesToReveal[i]);
    }

    if (newNonces.length !== noncesToReveal.length)
    {
      noncesToReveal = newNonces;
      window.store2.set('bknonces', noncesToReveal);
    }
  }

  //Run baker
  function run(keys)
  {
    //Inject pending blocks (baking)
    var nb = [];
    
    for(var i = 0; i < pendingBlocks.length; i++){
      var bb = pendingBlocks[i];
      if (bb.level <= head.header.level) continue; //prune
      if (injectedBlocks.indexOf(bb.level) >= 0) continue; //prune

      // Is it time to bake pending blocks?
      if (dateToTime(getDateNow()) >= dateToTime(bb.timestamp))
      {
        injectedBlocks.push(bb.level);

        /*
          Inject a block in the node and broadcast it. The `operations` embedded in `blockHeader` might be pre-validated using 
          a contextual RPCs from the latest block (e.g. '/blocks/head/context/preapply'). 
          Returns the ID of the block. By default, the RPC will wait for the block to be validated before answering. 
          If ?async is true, the function returns immediately. Otherwise, the block will be validated before the result is returned. 
          If ?force is true, it will be injected even on non strictly increasing fitness.
          An optional ?chain parameter can be used to specify whether to inject on the test chain or the main chain.
        */
        eztz.node.query('/injection/block?chain='+bb.chain_id, bb.data).then(function(hash)
        {
          if (bb.seed)
          {
            addNonce({
              hash : hash,
              seed_nonce_hash : bb.seed_nonce_hash,
              seed : bb.seed,
              level : bb.level,
              revealed : false
            });

            logOutput("+Injected block #" + hash + " at level " + bb.level + " with seed " + bb.seed + ".");
          } 
          else 
          {
            logOutput("+Injected block #" + hash + " at level " + bb.level + " with no seed.");
          }
        }).catch(function(e)
        {
          e = JSON.parse(e);
          if (Array.isArray(e) && e.length && typeof e[0].operation != 'undefined'){
            badOps.push(e[0].operation);
          }
          if (Array.isArray(e) && e.length && typeof e[0].id != 'undefined'){
            logOutput(e[0].id, bb);
          }
          logOutput("-Failed to bake with error");
          console.error("Inject failed", e);
        });
      }
      else nb.push(bb);
    }

    // reset pending blocks.
    pendingBlocks = nb;
    
    if (lockbaker) return;

    lockbaker = true;

    // We first get the current head. Based on that we can decide if we need to bake/endorse something.
    eztz.rpc.getHead().then(function(r)
    {
      lockbaker = false;
      head = r;
      
      //Run revealer
      revealNonces(keys, head);
      
      //TODO: Run accuser
      
      //Standown for 1 block
      if (startLevel === 0)
      {
        startLevel = head.header.level+1;
        logOutput("Initiate stand-down - starting at level " + startLevel);
      }

      if (startLevel > head.header.level) return;
      
      // Run endorser actions, but only if the current level wasn't done before.
      if (endorsedBlocks.indexOf(head.header.level) < 0)
      {
        (function(h){
          eztz.node.query('/chains/'+h.chain_id+'/blocks/'+h.hash+'/helpers/endorsing_rights?level='+h.header.level+"&delegate="+keys.pkh).then(function(rights)
          {
            // There is a chance that the header has changed in the same time we requested endorsing rights.
            if (h.header.level !== head.header.level) 
            {
              logOutput("Head changed when requesting endorsing rights for level " + h.header.level + ". Was: " + h.header.level + "/" + head.header.level);
              return;
            }

            if (rights.length > 0)
            {
              if (endorsedBlocks.indexOf(h.header.level) < 0) 
              {
                endorsedBlocks.push(h.header.level);
                return endorse(keys, h, rights[0].slots).then(function(r)
                {            
                  return "+Endorsed block #" + h.hash + " (" + r + ")";
                }).catch(function(e)
                {
                  return "!Failed to endorse block #" + h.hash, e;
                });
              }
            }
          }).then(function(r)
          {
            // After requesting endorsing rights and possible endorsing:
            if (r) logOutput(r);
            return r;
          }).catch(function(e)
          {
            // If something went wrong when requesting endorsing rights by querying the node.
            logOutput("!Error requesting endorsing rights.");
          });
        }(head));
      }

      // Run baker actions, but only if the current level wasn't done before.
      if (bakedBlocks.indexOf(head.header.level+1) < 0)
      {
        (function(h){

          /*
          Retrieves the list of delegates allowed to bake a block. 
          By default, it gives the best baking priorities for bakers that have at least one opportunity below 
          the 64th priority for the next block. Parameters `level` and `cycle` can be used to specify the (valid) 
          level(s) in the past or future at which the baking rights have to be returned. 
          Parameter `delegate` can be used to restrict the results to the given delegates. 
          If parameter `all` is set, all the baking opportunities for each baker at each level are returned, instead of just the first one. 
          Returns the list of baking slots. Also returns the minimal timestamps that correspond to these slots. 
          The timestamps are omitted for levels in the past, and are only estimates for levels later that the next block, 
          based on the hypothesis that all predecessor blocks were baked at the first priority.
          */
          eztz.node.query('/chains/'+h.chain_id+'/blocks/'+h.hash+'/helpers/baking_rights?level='+(h.header.level+1)+"&delegate="+keys.pkh).then(function(rights)
          {
            var bakerHeader = h.header.level+1;

            // There is a chance that the header has changed in the same time we requested baking rights.
            if (h.header.level !== head.header.level) 
            {
              logOutput("Head changed when requesting baking rights for level " + h.header.level+1 + ". Was: " + h.header.level + "/" + head.header.level);
              return;
            }
           
            if (bakedBlocks.indexOf(bakerHeader) < 0)
            {
              if (rights.length <= 0)
              {
                // We push this level in baked blocks so we do not request for baking rights, for this level, again.
                bakedBlocks.push((bakerHeader));
                return "Nothing to bake in level " + (bakerHeader) + ".";
              }
              else 
              {
                firstRight = rights[0];
                // Check if we are allowed to bake based on the current time.
                if (dateToTime(getDateNow()) >= (dateToTime(firstRight.estimated_time) + 5) && firstRight.level === bakerHeader)
                {
                  // We assume we can bake this block.
                  bakedBlocks.push((bakerHeader));
                  logOutput("-Trying to bake "+firstRight.level+"/"+firstRight.priority+"... ("+firstRight.estimated_time+")");

                  return bake(keys, h, firstRight.priority, firstRight.estimated_time, badOps).then(function(r)
                  {
                    // The baking (preapply) completed and the block is returned so it can be injected later.
                    pendingBlocks.push(r);
                    return "-Added potential block for level " + bakerHeader;
                  }).catch(function(e)
                  {
                    return "-Couldn't bake " + bakerHeader;
                  });
                } 
                else 
                {
                  return false;
                }
              }
            }
            else 
            {
              return "Already requested baking rights for level " + (bakerHeader) + ".";
            }
          }).then(function(r)
          {
            if (r) logOutput(r);
            return r;
          }).catch(function(e)
          {
            logOutput("!Error requesting baking rights");
            lockbaker = false;
            return false;
          });
        }(head));
      }
    }).catch(function(){
      lockbaker = false;
    });
  }

  // Baking timeout interval. 
  var bkint = false;
  var startLevel = 0;
  
  // Information about the current head.
  var head;

  // List of blocks that are in a pending state and need to be injected.
  var pendingBlocks = [];

  // List of blocks that we've injected within the current session.
  var injectedBlocks = [];

  // List of blocks that we've endorsed within the current session.
  var endorsedBlocks = [];

  // List of blocks that were baked within the current session.
  // Todo: clear previous baked blocks after some time.
  var bakedBlocks = [];

  // List of operations that failed within the current session.
  var badOps = [];

  var noncesToReveal = [];
  var lockbaker = false;  
  
  // Define a baking interval. This interval will be used to hit the baking/endorsing actions every time the interval is expired (in milliseconds).
  var bakingInterval = 1000;

  // Define global function for logging output.
  if (typeof logOutput !== "function")
  {
    var logOutput = function(e)
    {    
      if (typeof window.DEBUGMODE !== 'undefined' && window.DEBUGMODE)
        console.log(e);
    };
  }

  var Store = require('electron-store');
  window.store2 = new Store();
  loadNonces();

  return {
    start : function(keys)
    {
      logOutput("Starting baker...");
      if (bkint) 
      {
        clearInterval(bkint);
        bkint = false;
      }

      run(keys);
      bkint = setInterval(function() { run(keys); }, bakingInterval);
      return bkint;
    },

    stop : function()
    {
      logOutput("Stopping baker...");
      if (bkint) 
      {
        clearInterval(bkint);
        bkint = false;
      }
    },

    test : function()
    {
      logOutput("Testing baker...");
      var tests = [];
      for (i = 0; i < 5; i++)
      {
        tests[i] = [];
        for (ii = 0; ii < 131; ii++)
        {
          tests[i].push(Math.floor(Math.random()*256));
        }
      }

      return new Promise(function(resolve, reject){
        var start = new Date().getTime();
        powLoop(eztz.utility.buf2hex(tests[0]), 0, "4e07e55960daee56883d231b3c41f223733f58be90b5a1ee2147df8de5b8ac86", function(b, a1){
          powLoop(eztz.utility.buf2hex(tests[1]), 0, "4e07e55960daee56883d231b3c41f223733f58be90b5a1ee2147df8de5b8ac86", function(b, a2){
            powLoop(eztz.utility.buf2hex(tests[2]), 0, "4e07e55960daee56883d231b3c41f223733f58be90b5a1ee2147df8de5b8ac86", function(b, a3){
              powLoop(eztz.utility.buf2hex(tests[3]), 0, "4e07e55960daee56883d231b3c41f223733f58be90b5a1ee2147df8de5b8ac86", function(b, a4){
                powLoop(eztz.utility.buf2hex(tests[4]), 0, "4e07e55960daee56883d231b3c41f223733f58be90b5a1ee2147df8de5b8ac86", function(b, a5){
                  var a = a1 + a2 + a3 + a4 + a5;
                  var secs = ((new Date().getTime() - start)/1000).toFixed(3);
                  var hash = (a/secs)/1000;
                  resolve(hash);
                });
              });
            });
          });
        });
      });
    }
  };
}
BCBaker = initBCBaker();