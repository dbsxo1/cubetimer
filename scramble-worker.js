// 대회 방식(랜덤 상태) 3x3 스크램블을 백그라운드에서 만듦.
// 무작위로 섞인 큐브를 풀고, 그 풀이를 거꾸로 하면 스크램블이 됨.
importScripts('vendor/cubejs/cube.js', 'vendor/cubejs/solve.js');

let ready = false;

self.onmessage = (e) => {
  if (e.data !== 'next') return;
  if (!ready) {
    Cube.initSolver(); // 처음 한 번 표 계산 (몇 초 걸릴 수 있음)
    ready = true;
  }
  self.postMessage(Cube.scramble());
};
