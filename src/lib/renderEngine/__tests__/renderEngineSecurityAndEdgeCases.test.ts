import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RenderScheduler } from '../renderScheduler';
import { Priority, type RenderJob } from '../types';

describe('RenderEngine Scheduler Edge Cases & Memory Throttle Invariants', () => {

  let scheduler: RenderScheduler;

  beforeEach(() => {
    scheduler = new RenderScheduler();
  });

  describe('Priority Queue Ordering & FIFO Invariants', () => {
    it('dequeues Critical priority jobs before High and Normal priority jobs', () => {
      const normalJob: RenderJob = {
        jobId: 'job-normal',
        clipId: 'clip-1',
        epochId: 'epoch-1',
        priority: Priority.Normal,
        execute: vi.fn(),
      } as any;
      const highJob: RenderJob = {
        jobId: 'job-high',
        clipId: 'clip-1',
        epochId: 'epoch-1',
        priority: Priority.High,
        execute: vi.fn(),
      } as any;
      const criticalJob: RenderJob = {
        jobId: 'job-critical',
        clipId: 'clip-1',
        epochId: 'epoch-1',
        priority: Priority.Critical,
        execute: vi.fn(),
      } as any;

      scheduler.enqueue(normalJob);
      scheduler.enqueue(highJob);
      scheduler.enqueue(criticalJob);

      const first = scheduler.dequeue();
      expect(first?.jobId).toBe('job-critical');

      const second = scheduler.dequeue();
      expect(second?.jobId).toBe('job-high');

      const third = scheduler.dequeue();
      expect(third?.jobId).toBe('job-normal');
    });
  });

  describe('Clip Removal Job Cancellation', () => {
    it('cancels all queued jobs matching a deleted clipId', () => {
      const jobA: RenderJob = {
        jobId: 'job-A',
        clipId: 'clip-deleted',
        epochId: 'epoch-1',
        priority: Priority.High,
        execute: vi.fn(),
      } as any;
      const jobB: RenderJob = {
        jobId: 'job-B',
        clipId: 'clip-kept',
        epochId: 'epoch-1',
        priority: Priority.High,
        execute: vi.fn(),
      } as any;

      scheduler.enqueue(jobA);
      scheduler.enqueue(jobB);

      const cancelledCount = scheduler.cancelClip('clip-deleted');
      expect(cancelledCount).toBe(1);

      const remaining = scheduler.dequeue();
      expect(remaining?.jobId).toBe('job-B');
      expect(scheduler.dequeue()).toBeNull();
    });
  });

  describe('Memory Pressure Suspend / Resume Safety', () => {
    it('rejects dequeue operations while suspended under memory pressure', () => {
      const job: RenderJob = {
        jobId: 'job-1',
        clipId: 'clip-1',
        epochId: 'epoch-1',
        priority: Priority.Critical,
        execute: vi.fn(),
      } as any;

      scheduler.enqueue(job);
      scheduler.suspend();

      expect(scheduler.dequeue()).toBeNull();

      scheduler.resume();
      expect(scheduler.dequeue()?.jobId).toBe('job-1');
    });
  });

});
