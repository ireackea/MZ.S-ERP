
// This service simulates Apache Kafka in the browser.
// It allows different parts of the app (Sales, Inventory, HR) to communicate asynchronously.

type EventHandler = (payload: any) => void;

class EventBusService {
  private static instance: EventBusService;
  private listeners: Map<string, EventHandler[]>;

  private constructor() {
    this.listeners = new Map();
  }

  public static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  // Subscribe to a topic (Simulates Kafka Consumer)
  public subscribe(topic: string, handler: EventHandler): () => void {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, []);
    }
    this.listeners.get(topic)?.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.listeners.get(topic);
      if (handlers) {
        this.listeners.set(topic, handlers.filter(h => h !== handler));
      }
    };
  }

  // Publish an event (Simulates Kafka Producer)
  public publish(topic: string, payload: any): void {
    // console.debug(`[EventBus] Publishing to ${topic}:`, payload);
    const handlers = this.listeners.get(topic);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (e) {
          console.error(`[EventBus] Error handling topic ${topic}:`, e);
        }
      });
    }
  }
}

export const eventBus = EventBusService.getInstance();

// Event Topics Definition (Contracts)
export const TOPICS = {
  ORDER_CREATED: 'SALES.ORDER_CREATED',
  STOCK_UPDATED: 'INVENTORY.STOCK_UPDATED',
  TRANSACTION_ADDED: 'INVENTORY.TRANSACTION_ADDED',
  PARTNER_CREATED: 'CRM.PARTNER_CREATED',
  BACKUP_JOB_STARTED: 'PLATFORM.BACKUP_JOB_STARTED',
  BACKUP_JOB_COMPLETED: 'PLATFORM.BACKUP_JOB_COMPLETED',
  CRITICAL_OPERATION_STARTED: 'PLATFORM.CRITICAL_OPERATION_STARTED',
  CRITICAL_OPERATION_ENDED: 'PLATFORM.CRITICAL_OPERATION_ENDED',
};
