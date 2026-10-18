import { directionFallback, editWithVariant, type DirectionMessageTransport } from "./direction-message";

const PHRASE_VARIANT_MARK = "​";

/**
 * The phrase with an invisible trailing zero-width space, used when the
 * phrase message already shows exactly this phrase: Telegram rejects an edit
 * that keeps the text (MESSAGE_NOT_MODIFIED), and then nobody would see the
 * repeated phrase. phraseFromText strips the mark again.
 */
export function phraseVariant(text: string): string {
  return `${text}${PHRASE_VARIANT_MARK}`;
}

export function phraseFromText(text: string): string {
  return text.replace(/​+$/, "");
}

export interface PhraseDispatchTransport extends DirectionMessageTransport {
  getMessageId(): Promise<number | undefined>;
  setMessageId(messageId: number): Promise<void>;
}

export class PhraseDispatcher {
  private tail: Promise<void> = Promise.resolve();

  dispatch(text: string, transport: PhraseDispatchTransport): Promise<{ messageId: number; created: boolean }> {
    const operation = this.tail.then(async () => {
      const previousId = await transport.getMessageId();
      if (previousId !== undefined) {
        try {
          const edited = await editWithVariant(transport, previousId, text, phraseVariant(text));
          await transport.setMessageId(edited.id);
          return { messageId: edited.id, created: false };
        } catch (error) {
          if (directionFallback(transport.errorCode(error)) !== "send-new") throw error;
        }
      }
      const sent = await transport.send(text);
      await transport.setMessageId(sent.id);
      return { messageId: sent.id, created: true };
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
