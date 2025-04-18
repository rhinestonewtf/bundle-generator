export type Token = {
  symbol: string;
  amount: string;
};

export type Intent = {
  targetChain: string;
  targetTokens: Token[];
  sourceChains: string[];
  sourceTokens: string[];
  tokenRecipient: string;
};
