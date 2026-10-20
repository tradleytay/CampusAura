// Events highlights horizontal scroll lane (index.html)
(function(){
    function onReady(){
        const scrollTrack = document.getElementById('eventsScrollTrack');
        if(!scrollTrack) return;

        const shell = scrollTrack.closest('.events-animated-shell');
        const leftBtn = shell && shell.querySelector('.events-scroll-btn.left');
        const rightBtn = shell && shell.querySelector('.events-scroll-btn.right');
        const scroller = shell && shell.querySelector('.events-animated-scroll');

        const card = scrollTrack.querySelector('.events-scroll-card');
        const step = card ? (card.getBoundingClientRect().width + 16) : 280;

        function nudge(dir){
            if(!scroller) return;
            scroller.scrollBy({left: dir * step, behavior:'smooth'});
        }

        leftBtn && leftBtn.addEventListener('click', ()=>nudge(-1));
        rightBtn && rightBtn.addEventListener('click', ()=>nudge(1));

        // Drag-to-scroll
        let isDown=false, startX=0, startLeft=0;
        scroller && scroller.addEventListener('pointerdown', (e)=>{
        isDown=true;
        scroller.setPointerCapture(e.pointerId);
        startX=e.clientX;
        startLeft=scroller.scrollLeft;
    });

    scroller && scroller.addEventListener('pointerleave', ()=>{isDown=false});
    scroller && scroller.addEventListener('pointerup', ()=>{isDown=false});

    scroller && scroller.addEventListener('pointermove', (e)=>{
      if(!isDown) return;
      const dx = e.clientX - startX;
      scroller.scrollLeft = startLeft - dx;
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();

