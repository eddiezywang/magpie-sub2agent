"""Original internal marks, using the same 32px palette/outline as OmaPix."""
from vendor.pix import Canvas

def sub2agent():
    c = Canvas()
    # One connected, stepped S; highlights and a hard lower-right shade.
    c.poly([(9,3),(25,3),(27,5),(27,10),(14,10),(14,12),
            (23,16),(26,19),(26,24),(23,27),(6,27),(4,25),
            (4,20),(17,20),(17,18),(9,14),(6,11),(6,6)], 'B')
    c.hline(10,24,4,'b')
    c.hline(7,16,21,'b')
    c.hline(7,22,26,'6')
    c.rect(25,6,26,9,'6')
    c.hline(24,25,20,'6')
    c.outline().finalize()
    return c.rows()

def tig():
    c = Canvas()
    # TIG's blue/cyan folded ribbon and its open central square.
    c.poly([(4,9),(12,3),(28,3),(21,9)], 'b')
    c.poly([(4,9),(21,9),(21,24),(4,24)], 'B')
    c.poly([(21,9),(28,3),(28,18),(21,24)], '6')
    c.rect(12,10,20,17,'W')
    c.hline(6,19,10,'b')
    c.hline(5,20,23,'6')
    c.outline().finalize()
    return c.rows()

def cib():
    c = Canvas()
    # ZhiHuiTong penguin: charcoal head, cream face/belly and red scarf.
    c.ellipse(16,13,9,11,'k')
    c.poly([(8,14),(3,11),(3,18),(8,23)],'s')
    c.poly([(23,14),(28,18),(29,23),(23,22)],'s')
    c.ellipse(12,9,3,5,'W');c.ellipse(20,9,3,5,'W')
    c.rect(12,8,13,10,'K');c.rect(19,8,20,10,'K')
    c.poly([(12,13),(17,11),(22,13),(17,16)],'O')
    c.ellipse(16,22,7,4,'W')
    c.poly([(8,15),(24,15),(23,19),(9,19)],'R')
    c.poly([(23,16),(27,14),(27,20),(24,22)],'1')
    c.hline(10,21,16,'r')
    c.rect(9,26,14,27,'O');c.rect(20,26,25,27,'O')
    c.outline().finalize()
    return c.rows()
