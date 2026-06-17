#!/bin/bash
# $1=img $2=audio(optional:none) $3=dur $4=out
IMG=$1; AUD=$2; DUR=$3; OUT=$4
FADE_OUT=$(python3 -c "print(max(0,$DUR-0.45))")
FRAMES=$(python3 -c "print(int($DUR*25)+1)")
if [ "$AUD" = "none" ]; then
  ffmpeg -y -loop 1 -i "$IMG" -f lavfi -i anullsrc=r=44100:cl=stereo -t "$DUR" \
    -filter_complex "[0:v]scale=1920:1050:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf5f0e8,zoompan=z='min(1+0.00045*on,1.06)':d=$FRAMES:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=25,fade=t=in:st=0:d=0.4,fade=t=out:st=$FADE_OUT:d=0.45,format=yuv420p[v]" \
    -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 160k -shortest "$OUT" 2>&1 | tail -1
else
  ffmpeg -y -loop 1 -i "$IMG" -i "$AUD" -t "$DUR" \
    -filter_complex "[0:v]scale=1920:1050:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf5f0e8,zoompan=z='min(1+0.00045*on,1.06)':d=$FRAMES:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=25,fade=t=in:st=0:d=0.4,fade=t=out:st=$FADE_OUT:d=0.45,format=yuv420p[v];[1:a]adelay=600|600,apad,aresample=44100,aformat=channel_layouts=stereo[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 160k -shortest "$OUT" 2>&1 | tail -1
fi
