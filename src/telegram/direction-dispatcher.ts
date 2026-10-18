import {
  sendOrEditDirection,
  type Direction,
  type DirectionMessageTransport,
} from "./direction-message";

export interface DirectionDispatchTransport extends DirectionMessageTransport {
  getMessageId(): Promise<number | undefined>;
  setMessageId(messageId: number): Promise<void>;
}

/** Serializes direction updates so every chat keeps one editable signal message. */
export class DirectionDispatcher {
  private tail: Promise<void> = Promise.resolve();

  dispatch(
    direction: Direction,
    transport: DirectionDispatchTransport,
  ): Promise<{ messageId: number; created: boolean }> {
    const operation = this.tail.then(async () => {
      const messageId = await transport.getMessageId();
      const result = await sendOrEditDirection({ direction, messageId }, transport);
      await transport.setMessageId(result.messageId);
      return result;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
