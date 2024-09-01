var youtubeLink = 'https://www.youtube.com/watch?v=Xowt0bff49I&t=108s';


function openYouTubeLinkInBackground() {
    var newTab = window.open(youtubeLink, '_blank');
    window.focus();
  }
  
  openYouTubeLinkInBackground();