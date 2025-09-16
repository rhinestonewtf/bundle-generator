TOKEN_RECIPIENT="0xF7C012789aac54B5E33EA5b88064ca1F1172De05"
NETWORKS=(Base Arbitrum)
TOKENS=(ETH WETH USDC)
AMOUNT="0.000002"
SPONSORED_VALUES=(true)
DESTINATION_OPS_VALUES=(true)
SETTLEMENT_LAYERS=("RELAY")

for SRC_NET in "${NETWORKS[@]}"; do
  for TGT_NET in "${NETWORKS[@]}"; do
    if [ "$SRC_NET" == "$TGT_NET" ]; then
      # Same network - no settlement layer needed
      for SPONSORED in "${SPONSORED_VALUES[@]}"; do
        for TGT_TOKEN in "${TOKENS[@]}"; do
          echo "Generating intent for $SRC_NET -> $TGT_NET ($TGT_TOKEN) (sponsored: $SPONSORED)"
          FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${TGT_TOKEN}_sponsored_${SPONSORED}.json"
          echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [{"symbol": "'$TGT_TOKEN'", "amount": "'$AMOUNT'"}], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": [], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
        done
        # also add cases without token transfers
        echo "Generating intent for $SRC_NET -> $TGT_NET (no transfers) (sponsored: $SPONSORED)"
        FILENAME="intents/${SRC_NET}_to_${TGT_NET}_no_transfers_sponsored_${SPONSORED}.json"
        echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": [], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
      done
    else
      # Different networks - loop over settlement layers
      for TGT_TOKEN in "${TOKENS[@]}"; do
        for SETTLEMENT_LAYER in "${SETTLEMENT_LAYERS[@]}"; do
          if [ "$SETTLEMENT_LAYER" != "ECO" ] || [ "$TGT_TOKEN" == "USDC" ]; then
            for SPONSORED in "${SPONSORED_VALUES[@]}"; do
              for DESTINATION_OPS in "${DESTINATION_OPS_VALUES[@]}"; do
                echo "Generating intent for $SRC_NET -> $TGT_NET ($TGT_TOKEN) (settlementLayer: $SETTLEMENT_LAYER) (sponsored: $SPONSORED)"
                FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${TGT_TOKEN}_${SETTLEMENT_LAYER}_sponsored_${SPONSORED}.json"
                echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [{"symbol": "'$TGT_TOKEN'", "amount": "'$AMOUNT'"}], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": ["'$SETTLEMENT_LAYER'"], "sponsored": '$SPONSORED', "destinationOps": '$DESTINATION_OPS'}]}' > "$FILENAME"
              done
            done
          fi
        done
      done
    fi
  done
done
