import { useTheme } from "@/components/theme-provider";
import { useGetWallet } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Moon, Sun, Monitor, Shield, Bell, Network } from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: wallet, isLoading } = useGetWallet();

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-1">Settings</h1>
        <p className="text-muted-foreground">Manage your preferences and connection</p>
      </div>

      <div className="grid gap-6">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Wallet Connection
            </CardTitle>
            <CardDescription>Your connected Stellar wallet details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Address</Label>
              {isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="p-3 bg-muted/50 rounded-lg font-mono text-sm break-all border border-border">
                  {wallet?.address || "Not connected"}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Network</Label>
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <div className="font-medium capitalize">{wallet?.network || "Public"}</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5 text-primary" />
              Appearance
            </CardTitle>
            <CardDescription>Customize how Orbit looks on your device</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Dark Mode</Label>
                <div className="text-sm text-muted-foreground">
                  Switch between light and dark themes
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Sun className="h-4 w-4 text-muted-foreground" />
                <Switch 
                  checked={theme === 'dark'} 
                  onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                  className="data-[state=checked]:bg-orbit-gradient"
                />
                <Moon className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">System Theme</Label>
                <div className="text-sm text-muted-foreground">
                  Automatically match your system preferences
                </div>
              </div>
              <Switch 
                checked={theme === 'system'} 
                onCheckedChange={(checked) => {
                  if (checked) setTheme('system');
                  else setTheme('dark');
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Notifications
            </CardTitle>
            <CardDescription>Manage your alerts and updates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Transaction Alerts</Label>
                <div className="text-sm text-muted-foreground">
                  Get notified when transactions complete
                </div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Yield Updates</Label>
                <div className="text-sm text-muted-foreground">
                  Weekly summary of your earned yield
                </div>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
