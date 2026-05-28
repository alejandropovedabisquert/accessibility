type QueueTask<TIn, TOut> = {
    input: TIn;
    resolve: (value: TOut) => void;
    reject: (reason?: unknown) => void;
};

type QueueWorker<TIn, TOut> = (input: TIn) => Promise<TOut>;

export class AsyncTaskQueue<TIn, TOut> {
    private readonly queue: Array<QueueTask<TIn, TOut>> = [];
    private activeTasks = 0;

    constructor(
        private readonly worker: QueueWorker<TIn, TOut>,
        private readonly maxConcurrent: number = 1,
        private readonly label: string = "queue"
    ) {}

    public enqueue(input: TIn): Promise<TOut> {
        return new Promise<TOut>((resolve, reject) => {
            this.queue.push({ input, resolve, reject });
            this.process();
        });
    }

    public getStats() {
        return {
            label: this.label,
            active: this.activeTasks,
            waiting: this.queue.length,
            maxConcurrent: this.maxConcurrent,
        };
    }

    private process(): void {
        while (this.activeTasks < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) {
                return;
            }

            this.activeTasks++;
            console.log(
                `[AsyncTaskQueue:${this.label}] started. Active: ${this.activeTasks}. Waiting: ${this.queue.length}`
            );
            void this.runTask(task);
        }
    }

    private async runTask(task: QueueTask<TIn, TOut>): Promise<void> {
        try {
            const result = await this.worker(task.input);
            task.resolve(result);
        } catch (error) {
            task.reject(error);
        } finally {
            this.activeTasks--;
            this.process();
        }
    }
}