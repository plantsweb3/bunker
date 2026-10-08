/** The program's refusal codes (programs/bunker3/src/state.rs, `Refusal`) as
 * sentences. The numbers are part of the program's interface. */
export const REFUSALS: Record<number, string> = {
  101: "This was made for a different Bunker or a different network. Nothing happened.",
  110: "This key is no longer your Bunker’s current one: it has already been used, or the keys were replaced. Refresh and check the activity; a withdrawal of yours may already have gone through.",
  111: "A withdrawal is already pending. Release it, clear it, or cancel it with your recovery kit before starting another.",
  112: "This withdrawal’s authorization ran out of time before it reached the network, so it can no longer be sent. Its key cannot sign again: install new keys in the recovery tool to continue. Nothing has left your Bunker.",
  113: "The authorization’s deadline is too far ahead. Check this device’s date and time.",
  114: "This would bring back a key that has already signed, which is never allowed. Install new keys in the recovery tool.",
  116: "That token is not a kind Bunker can hold or send. Only classic SPL tokens are supported.",
  117: "This token’s real number of decimal places is not the one you were shown, so nothing was sent. Your connection may be reporting the token wrongly; try another connection before trying again.",
  118: "That destination cannot be used for a withdrawal.",
  120: "There is no pending withdrawal.",
  121: "The waiting period is not over yet.",
  122: "This withdrawal was not released in time. Clear it, then announce it again if it is still wanted.",
  123: "That is not the destination this withdrawal was announced for.",
  124: "That amount would leave your Bunker below the small balance every Bunker must keep. Withdraw slightly less.",
  125: "The token accounts for this withdrawal cannot be used. The recipient’s token account may have been closed or frozen, or your Bunker’s own balance changed.",
  130: "That withdrawal has not expired yet, so it cannot be cleared. It can still be released.",
  140: "This recovery packet is for a different key generation than your Bunker is on.",
  150: "The authorization was not fully uploaded. Try again; the same upload continues.",
  160: "That creation request is not valid.",
  161: "That creation request does not match the address it names.",
};
/** The sentence for a failed step, if the program gave one of its own reasons.
 * Reads the code out of whatever text the failure was reported in. */
export function refusalText(message: string): string | null {
  const m = /"Custom"\s*:\s*(\d+)/.exec(message) ?? /\bCustom\((\d+)\)/.exec(message);
  if (!m) return null;
  return REFUSALS[Number(m[1])] ?? null;
}
