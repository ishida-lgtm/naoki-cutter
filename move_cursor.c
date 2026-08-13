#include <ApplicationServices/ApplicationServices.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int parse_coordinate(const char *text, double *value) {
  char *end = NULL;
  errno = 0;
  const double parsed = strtod(text, &end);
  if (errno != 0 || end == text || *end != '\0' || !isfinite(parsed)) return 0;
  *value = parsed;
  return 1;
}

int main(int argc, char *argv[]) {
  if (argc == 2 && strcmp(argv[1], "--get") == 0) {
    CGEventRef event = CGEventCreate(NULL);
    if (!event) return 2;
    const CGPoint point = CGEventGetLocation(event);
    CFRelease(event);
    printf("%.3f %.3f\n", point.x, point.y);
    return 0;
  }

  if (argc != 3) return 1;
  double x = 0;
  double y = 0;
  if (!parse_coordinate(argv[1], &x) || !parse_coordinate(argv[2], &y)) return 1;

  const CGError result = CGWarpMouseCursorPosition(CGPointMake(x, y));
  if (result != kCGErrorSuccess) return 2;
  CGAssociateMouseAndMouseCursorPosition(true);
  return 0;
}
