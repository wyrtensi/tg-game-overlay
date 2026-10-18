import { directionFallback, type DirectionMessageTransport } from "./direction-message";

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
          const edited = await transport.edit(previousId, text);
          await transport.setMessageId(edited.id);
          return { messageId: edited.id, created: false };
        } catch (error) {
          const code = transport.errorCode(error);
          if (code === "MESSAGE_NOT_MODIFIED") return { messageId: previousId, created: false };
          if (directionFallback(code) !== "send-new") throw error;
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
