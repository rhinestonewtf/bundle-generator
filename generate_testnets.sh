TOKEN_RECIPIENT="0xF7C012789aac54B5E33EA5b88064ca1F1172De05"
NETWORKS=(BaseSepolia ArbitrumSepolia)
TOKENS=(ETH WETH USDC)
AMOUNT="0.000002"
SPONSORED_VALUES=(true false)
SETTLEMENT_LAYERS=("ACROSS" "ECO")

for SRC_NET in "${NETWORKS[@]}"; do
  for TGT_NET in "${NETWORKS[@]}"; do
    if [ "$SRC_NET" == "$TGT_NET" ]; then
      # Same network - no settlement layer needed
      for TGT_TOKEN in "${TOKENS[@]}"; do
        for SPONSORED in "${SPONSORED_VALUES[@]}"; do
          echo "Generating intent for $SRC_NET -> $TGT_NET ($TGT_TOKEN) (sponsored: $SPONSORED)"
          FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${TGT_TOKEN}_sponsored_${SPONSORED}.json"
          echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [{"symbol": "'$TGT_TOKEN'", "amount": "'$AMOUNT'"}], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": [], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
        done
      done
    else
      # Different networks - loop over settlement layers
      for TGT_TOKEN in "${TOKENS[@]}"; do
        for SETTLEMENT_LAYER in "${SETTLEMENT_LAYERS[@]}"; do
          if [ "$SETTLEMENT_LAYER" != "ECO" ] || [ "$TGT_TOKEN" == "USDC" ]; then
            for SPONSORED in "${SPONSORED_VALUES[@]}"; do
              echo "Generating intent for $SRC_NET -> $TGT_NET ($TGT_TOKEN) (settlementLayer: $SETTLEMENT_LAYER) (sponsored: $SPONSORED)"
              FILENAME="intents/${SRC_NET}_to_${TGT_NET}_${TGT_TOKEN}_${SETTLEMENT_LAYER}_sponsored_${SPONSORED}.json"
              echo '{"intentList": [{"targetChain": "'$TGT_NET'", "targetTokens": [{"symbol": "'$TGT_TOKEN'", "amount": "'$AMOUNT'"}], "sourceChains": ["'$SRC_NET'"], "sourceTokens": [], "tokenRecipient": "'$TOKEN_RECIPIENT'", "settlementLayers": ["'$SETTLEMENT_LAYER'"], "sponsored": '$SPONSORED'}]}' > "$FILENAME"
            done
          fi
        done
      done
    fi
  done
done
