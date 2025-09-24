TOKEN_RECIPIENT="0xF7C012789aac54B5E33EA5b88064ca1F1172De05"
NETWORKS=(Base Arbitrum)
TOKENS=(USDC)
AMOUNT="0.000002"
SPONSORED_VALUES=(false)
DESTINATION_OPS_VALUES=(true false)
SETTLEMENT_LAYERS=("ACROSS")

for SRC_NET in "${NETWORKS[@]}"; do
  for TGT_NET in "${NETWORKS[@]}"; do
    if [ "$SRC_NET" == "$TGT_NET" ]; then
      # Same network - no settlement layer needed
      for SPONSORED in "${SPONSORED_VALUES[@]}"; do
        for ((mask=1; mask<(1<<${#TOKENS[@]}); mask++)); do
            tokens=()
            for ((i=0; i<${#TOKENS[@]}; i++)); do
                ((mask & (1<<i))) && tokens+=("${TOKENS[i]}")
            done
            
          target_tokens_json=""
          for token in "${tokens[@]}"; do
              if [ -z "$target_tokens_json" ]; then
                  target_tokens_json='{"symbol": "'$token'", "amount": "'$AMOUNT'"}'
              else
                  target_tokens_json="$target_tokens_json, "'{"symbol": "'$token'", "amount": "'$AMOUNT'"}'
              fi
          done
          token_combo=$(IFS=_; echo "${tokens[*]}")
          echo "Generating intent for $SRC_NET -> $TGT_NET ($token_combo) (sponsored: $SPONSORED)"
          FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${token_combo}_sponsored_${SPONSORED}.json"
          echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": ['$target_tokens_json'], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": [], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
        done
        # also add cases without token transfers
        echo "Generating intent for $SRC_NET -> $TGT_NET (no transfers) (sponsored: $SPONSORED)"
        FILENAME="intents/${SRC_NET}_to_${TGT_NET}_no_transfers_sponsored_${SPONSORED}.json"
        echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": [], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
      done
    else
      # Different networks - loop over settlement layers
      for SETTLEMENT_LAYER in "${SETTLEMENT_LAYERS[@]}"; do
        for SPONSORED in "${SPONSORED_VALUES[@]}"; do
          for DESTINATION_OPS in "${DESTINATION_OPS_VALUES[@]}"; do
            for ((mask=1; mask<(1<<${#TOKENS[@]}); mask++)); do
                tokens=()
                for ((i=0; i<${#TOKENS[@]}; i++)); do
                    ((mask & (1<<i))) && tokens+=("${TOKENS[i]}")
                done
                
              target_tokens_json=""
              for token in "${tokens[@]}"; do
                  if [ -z "$target_tokens_json" ]; then
                      target_tokens_json='{"symbol": "'$token'", "amount": "'$AMOUNT'"}'
                  else
                      target_tokens_json="$target_tokens_json, "'{"symbol": "'$token'", "amount": "'$AMOUNT'"}'
                  fi
              done
              token_combo=$(IFS=_; echo "${tokens[*]}")
              echo "Generating intent for $SRC_NET -> $TGT_NET ($token_combo) (settlementLayer: $SETTLEMENT_LAYER) (sponsored: $SPONSORED)"
              FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${token_combo}_${SETTLEMENT_LAYER}_sponsored_${SPONSORED}_destops_${DESTINATION_OPS}.json"
              echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": ['$target_tokens_json'], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": ["'$SETTLEMENT_LAYER'"], "sponsored": '$SPONSORED', "destinationOps": '$DESTINATION_OPS'}]}' > "$FILENAME"
            done
          done
        done
      done
    fi
  done
done
