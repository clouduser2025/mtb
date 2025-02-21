import React, { useState, useEffect, useCallback } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCog, faUserPlus, faUsers, faSignInAlt, faShoppingCart, faExchangeAlt, faChartLine, faCalendarAlt, faDollarSign } from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  const [users, setUsers] = useState([]); 
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [activeTradeId, setActiveTradeId] = useState(null);
  const [optionChainData, setOptionChainData] = useState(null);
  const [marketData, setMarketData] = useState({ ltp: 0.0, volume: 0, timestamp: "" });

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Shoonya",
    api_key: "",
    totp_token: "",
    vendor_code: "",
    default_quantity: 1,
    symbol: "NIFTY",
    expiry: "25 Feb 2025 W",
    strike_price: 75000,
    option_type: "Call",
    tradingsymbol: "",
    symboltoken: "",
    exchange: "NFO",
    buy_type: "Fixed",
    buy_threshold: 110,  // Default: Buy if LTP ≥ ₹110 above current
    previous_close: 0,
    producttype: "INTRADAY",
    stop_loss_type: "Fixed",
    stop_loss_value: 5.0,  // Default: Sell if LTP ≤ ₹5 below entry
    points_condition: 0,
    sell_type: "Fixed",
    sell_threshold: 90   // Default: Sell if LTP ≤ ₹90 below entry
  });

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades");
      const data = await response.json();
      setOpenTrades(data.trades || []);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const fetchOptionChain = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      const username = selectedUsers[0]; // Assuming single user for option chain
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_option_chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          symbol: formData.symbol,
          expiry: formData.expiry,
          strike_price: formData.strike_price,
          option_type: formData.option_type
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setOptionChainData(data);
        setFormData({
          ...formData,
          tradingsymbol: data.tradingsymbol,
          symboltoken: data.token,
          previous_close: data.call_ltp || data.put_ltp || 0
        });
        setMessage({ text: "Option chain data fetched successfully!", type: "success" });
        setFormStep(6); // Move to trading conditions step
        startMarketUpdates(username, data.token); // Start real-time updates
      } else {
        setMessage({ text: data.detail || "Failed to fetch option chain", type: "danger" });
      }
    } catch (error) {
      console.error("Error fetching option chain:", error);
      setMessage({ text: "Server error fetching option chain.", type: "danger" });
    }
  };

  const startMarketUpdates = useCallback((username, symboltoken) => {
    const ws = new WebSocket(`wss://mtb-8ra9.onrender.com/api/websocket/${username}/${symboltoken}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMarketData({
        ltp: data.ltp || 0.0,
        volume: data.market_data?.v || 0,
        timestamp: data.market_data?.ft || new Date().toISOString()
      });
    };
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setMessage({ text: "WebSocket connection failed. Falling back to polling.", type: "warning" });
      // Fallback to polling
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`https://mtb-8ra9.onrender.com/api/get_market_data/${username}/${symboltoken}`);
          if (response.ok) {
            const data = await response.json();
            setMarketData({
              ltp: data.ltp,
              volume: data.market_data.v || 0,
              timestamp: data.market_data.ft || new Date().toISOString()
            });
          }
        } catch (error) {
          console.error("Error polling market data:", error);
          setMessage({ text: "Failed to fetch real-time market data.", type: "danger" });
        }
      }, 1000);
      return () => clearInterval(pollInterval);
    };
    ws.onclose = () => {
      console.log("WebSocket closed. Attempting to reconnect...");
      startMarketUpdates(username, symboltoken); // Attempt to reconnect
    };
    return () => ws.close();
  }, []);
  
    ws.onclose = () => {
      console.log("WebSocket closed. Attempting to reconnect...");
      startMarketUpdates(username, symboltoken); // Attempt to reconnect
    };
    return () => ws.close();
  }, []);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: formData.username,
        password: formData.password,
        broker: formData.broker,
        api_key: formData.api_key,
        totp_token: formData.totp_token,
        default_quantity: parseInt(formData.default_quantity || 1, 10),
      };
      if (formData.broker === "Shoonya") {
        payload.vendor_code = formData.vendor_code;
      }
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `User ${formData.username} registered successfully (${formData.broker})!`, type: "success" });
        fetchUsers();
        setFormData({ ...formData, username: "", password: "", api_key: "", totp_token: "", vendor_code: "" });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: `Server error registering ${formData.broker} user. Try again later.`, type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, { method: "DELETE" });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

        const adjustedProductType = user.broker === "Shoonya" && formData.producttype === "INTRADAY" ? "I" : formData.producttype;

        const response = await fetch("https://mtb-8ra9.onrender.com/api/initiate_buy_trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            tradingsymbol: formData.tradingsymbol,
            symboltoken: formData.symboltoken,
            exchange: formData.exchange,
            strike_price: formData.strike_price,
            buy_type: formData.buy_type,
            buy_threshold: formData.buy_threshold,
            previous_close: formData.previous_close,
            producttype: adjustedProductType,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
            sell_type: formData.sell_type,
            sell_threshold: formData.sell_threshold
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Buy trade initiated for ${username} (${user.broker})! Position ID: ${data.position_id}`, type: "success" });
          setActiveTradeId(data.position_id);
          fetchOpenPositions();
        } else {
          setMessage({ text: `Failed for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade.", type: "danger" });
    }
    setFormStep(1);
    setSelectedUsers([]);
  };

  const handleUpdateConditions = async () => {
    if (!activeTradeId || !selectedUsers.length) {
      setMessage({ text: "No active trade or users selected for update.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

        const response = await fetch("https://mtb-8ra9.onrender.com/api/update_trade_conditions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            position_id: activeTradeId,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Conditions updated for ${username} (${user.broker})!`, type: "success" });
        } else {
          setMessage({ text: `Failed to update for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error updating conditions:", error);
      setMessage({ text: "Server error updating conditions.", type: "danger" });
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.shoonya.com/login', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Shoonya Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <Container className="mt-4">
      {message.text && (
        <Alert variant={message.type === "success" ? "success" : "danger"} className="mt-3 mb-3" style={{ backgroundColor: message.type === "success" ? "#d4edda" : "#f8d7da", color: message.type === "success" ? "#155724" : "#721c24" }}>
          {message.text}
        </Alert>
      )}

      <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
        <Col xs="auto">
          <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
        </Col>
      </Row>

      {showUsers && (
        <Container className="users-table-container mb-5">
          <h3 className="text-center mb-4 text-primary"><FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users</h3>
          <Table striped bordered hover>
            <thead>
              <tr>
                <th>#</th>
                <th>Username</th>
                <th>Broker</th>
                <th>Default Quantity</th>
                <th>Vendor Code</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? (
                users.map((user, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{user.username}</td>
                    <td>{user.broker}</td>
                    <td>{user.default_quantity}</td>
                    <td>{user.broker === "Shoonya" ? user.vendor_code || "N/A" : "N/A"}</td>
                    <td><Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>Delete</Button></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="6" className="text-muted text-center">No registered users found.</td></tr>
              )}
            </tbody>
          </Table>
        </Container>
      )}

      {showTradesDashboard && (
        <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
          <h3 className="text-center mb-4 text-dark fw-bold"><FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades</h3>
          <Table striped bordered hover>
            <thead>
              <tr>
                <th>#</th>
                <th>Username</th>
                <th>Symbol</th>
                <th>Entry Price</th>
                <th>Buy Threshold</th>
                <th>Stop-Loss Type</th>
                <th>Stop-Loss Value</th>
                <th>Sell Threshold</th>
                <th>Position</th>
                <th>Broker</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.length > 0 ? (
                openTrades.map((trade, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{trade.username}</td>
                    <td>{trade.symbol}</td>
                    <td style={{ color: "green" }}>₹{trade.entry_price}</td>
                    <td>₹{trade.buy_threshold}</td>
                    <td>{trade.stop_loss_type}</td>
                    <td>{trade.stop_loss_value}</td>
                    <td style={{ color: "red" }}>₹{trade.sell_threshold || "N/A"}</td>
                    <td><span className="badge bg-success">Buy</span></td>
                    <td>{users.find(u => u.username === trade.username)?.broker || "Unknown"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="10" className="text-muted text-center">No active trades found.</td></tr>
              )}
            </tbody>
          </Table>
        </Container>
      )}

      <Row className="justify-content-center mb-3">
        <Col xs="auto"><Button onClick={() => window.open('https://www.shoonya.com/markets/equity/overview', '_blank')}>Market Overview</Button></Col>
        <Col xs="auto"><Button onClick={() => window.open('https://www.shoonya.com/markets/indices/indian', '_blank')}>Indices</Button></Col>
        <Col xs="auto"><Button onClick={() => window.open('https://www.shoonya.com/markets/watchlist/chart', '_blank')}>Chart</Button></Col>
        <Col xs="auto"><Button onClick={() => window.open('https://www.shoonya.com/markets/watchlist/option-chain', '_blank')}>Option Chain</Button></Col>
        <Col xs="auto"><Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }}>Trades Dashboard</Button></Col>
      </Row>

      <Container className="mt-4 p-3 border rounded shadow-sm">
        {formStep === 1 && (
          <>
            <h4 className="text-primary"><FontAwesomeIcon icon={faUsers} /> Step 1: Select User (1 only)</h4>
            <Form>
              <Row className="mb-3">
                <Col>
                  {users.map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 1) setSelectedUsers([user.username]); // Limit to 1 user
                          else alert("⚠ You can only select 1 user for option trading.");
                        } else {
                          setSelectedUsers([]);
                        }
                      }}
                    />
                  ))}
                </Col>
              </Row>
              <Button variant="primary" onClick={() => { if (selectedUsers.length) setFormStep(2); else alert("Select 1 user."); }}>Next</Button>
            </Form>
          </>
        )}

        {formStep === 2 && (
          <>
            <h4 className="text-primary"><FontAwesomeIcon icon={faChartLine} /> Step 2: Select Symbol</h4>
            <Form>
              <Row className="mb-3">
                <Col md={6}><Form.Group><Form.Label>Symbol</Form.Label><Form.Control type="text" value={formData.symbol} onChange={(e) => setFormData({ ...formData, symbol: e.target.value })} required /></Form.Group></Col>
              </Row>
              <Button variant="primary" onClick={() => setFormStep(3)}>Next</Button>
              <Button variant="secondary" onClick={() => { setFormStep(1); setSelectedUsers([]); }} className="ms-2">Back</Button>
            </Form>
          </>
        )}

        {formStep === 3 && (
          <>
            <h4 className="text-primary"><FontAwesomeIcon icon={faCalendarAlt} /> Step 3: Select Expiry</h4>
            <Form>
              <Row className="mb-3">
                <Col md={6}><Form.Group><Form.Label>Expiry (e.g., 25 Feb 2025 W)</Form.Label><Form.Control type="text" value={formData.expiry} onChange={(e) => setFormData({ ...formData, expiry: e.target.value })} required /></Form.Group></Col>
              </Row>
              <Button variant="primary" onClick={() => setFormStep(4)}>Next</Button>
              <Button variant="secondary" onClick={() => setFormStep(2)} className="ms-2">Back</Button>
            </Form>
          </>
        )}

        {formStep === 4 && (
          <>
            <h4 className="text-primary"><FontAwesomeIcon icon={faDollarSign} /> Step 4: Select Strike Price</h4>
            <Form>
              <Row className="mb-3">
                <Col md={6}><Form.Group><Form.Label>Strike Price</Form.Label><Form.Control type="number" value={formData.strike_price} onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
              </Row>
              <Button variant="primary" onClick={() => setFormStep(5)}>Next</Button>
              <Button variant="secondary" onClick={() => setFormStep(3)} className="ms-2">Back</Button>
            </Form>
          </>
        )}

        {formStep === 5 && (
          <>
            <h4 className="text-primary"><FontAwesomeIcon icon={faExchangeAlt} /> Step 5: Select Option Type</h4>
            <Form>
              <Row className="mb-3">
                <Col md={6}><Form.Group><Form.Label>Option Type</Form.Label><Form.Select value={formData.option_type} onChange={(e) => setFormData({ ...formData, option_type: e.target.value })}>
                  <option value="Call">Call</option>
                  <option value="Put">Put</option>
                </Form.Select></Form.Group></Col>
              </Row>
              <Button variant="primary" onClick={fetchOptionChain}>Fetch Option Chain</Button>
              <Button variant="secondary" onClick={() => setFormStep(4)} className="ms-2">Back</Button>
            </Form>
          </>
        )}

        {formStep === 6 && optionChainData && (
          <>
            <h4 className="text-success"><FontAwesomeIcon icon={faShoppingCart} /> Step 6: Set Buy, Stop-Loss, and Sell Conditions (Live Market Data)</h4>
            <p><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, Volume: {marketData.volume}, Last Update: {marketData.timestamp}</p>
            <Form>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group><Form.Label>Buy Condition Type</Form.Label>
                    <Form.Select value={formData.buy_type} onChange={(e) => setFormData({ ...formData, buy_type: e.target.value })}>
                      <option value="Fixed">Fixed Price (e.g., ₹110)</option>
                      <option value="Percentage">Percentage Increase (e.g., 5%)</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}><Form.Group><Form.Label>{formData.buy_type === "Fixed" ? "Buy Threshold" : "Buy % Increase"}</Form.Label><Form.Control type="number" value={formData.buy_threshold} onChange={(e) => setFormData({ ...formData, buy_threshold: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                {formData.buy_type === "Percentage" && (
                  <Col md={4}><Form.Group><Form.Label>Previous Close</Form.Label><Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                )}
                <Col md={4}><Form.Group><Form.Label>Product Type</Form.Label>
                  <Form.Select value={formData.producttype} onChange={(e) => setFormData({ ...formData, producttype: e.target.value })}>
                    <option value="INTRADAY">MIS (Intraday)</option>
                    <option value="C">CNC (Cash and Carry)</option>
                    <option value="M">NRML (Normal)</option>
                    <option value="B">Bracket Order</option>
                    <option value="H">Cover Order</option>
                  </Form.Select>
                </Form.Group></Col>
              </Row>
              <Row className="mb-3">
                <Col md={4}><Form.Group><Form.Label>Stop-Loss Type</Form.Label><Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}>
                  <option value="Fixed">Fixed</option>
                  <option value="Percentage">Percentage</option>
                  <option value="Points">Points</option>
                </Form.Select></Form.Group></Col>
                <Col md={4}><Form.Group><Form.Label>Stop-Loss Value</Form.Label><Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                <Col md={4}><Form.Group><Form.Label>Points Condition</Form.Label><Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
              </Row>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group><Form.Label>Sell Condition Type</Form.Label>
                    <Form.Select value={formData.sell_type} onChange={(e) => setFormData({ ...formData, sell_type: e.target.value })}>
                      <option value="Fixed">Fixed Price (e.g., ₹90)</option>
                      <option value="Percentage">Percentage Decrease (e.g., 5%)</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}><Form.Group><Form.Label>{formData.sell_type === "Fixed" ? "Sell Threshold" : "Sell % Decrease"}</Form.Label><Form.Control type="number" value={formData.sell_threshold} onChange={(e) => setFormData({ ...formData, sell_threshold: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                {formData.sell_type === "Percentage" && (
                  <Col md={4}><Form.Group><Form.Label>Previous Close</Form.Label><Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                )}
              </Row>
              <Row className="mb-3">
                <Col>
                  <p><strong>Selected User:</strong> {selectedUsers.join(", ")}</p>
                  <p><strong>Symbol:</strong> {formData.symbol}</p>
                  <p><strong>Expiry:</strong> {formData.expiry}</p>
                  <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                  <p><strong>Option Type:</strong> {formData.option_type}</p>
                  <p style={{ color: "green" }}><strong>Buy Condition:</strong> {formData.buy_type === "Fixed" ? `≥ ₹${formData.buy_threshold}` : `≥ ₹${(formData.previous_close * (1 + formData.buy_threshold / 100)).toFixed(2)} (${formData.buy_threshold}%)`}</p>
                  <p style={{ color: "red" }}><strong>Stop-Loss:</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                  <p style={{ color: "red" }}><strong>Sell Condition:</strong> {formData.sell_type === "Fixed" ? `≤ ₹${formData.sell_threshold}` : `≤ ₹${(formData.previous_close * (1 - formData.sell_threshold / 100)).toFixed(2)} (${formData.sell_threshold}%)`}</p>
                  <p><strong>Product Type:</strong> {formData.producttype}</p>
                  <p><strong>Broker:</strong> {users.find(u => u.username === selectedUsers[0])?.broker || "Unknown"}</p>
                </Col>
              </Row>
              <Button variant="success" onClick={handleInitiateTrade}>Execute Trade</Button>
              <Button variant="secondary" onClick={() => setFormStep(5)} className="ms-2">Back</Button>
            </Form>
          </>
        )}
      </Container>

      {activeTradeId && (
        <Container className="mt-4 p-3 border rounded shadow-sm">
          <h4 className="text-warning"><FontAwesomeIcon icon={faExchangeAlt} /> Update Sell Conditions (Live Market Data)</h4>
          <p><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, Volume: {marketData.volume}, Last Update: {marketData.timestamp}</p>
          <Form>
            <Row className="mb-3">
              <Col md={4}><Form.Group><Form.Label>Stop-Loss Type</Form.Label><Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}>
                <option value="Fixed">Fixed</option>
                <option value="Percentage">Percentage</option>
                <option value="Points">Points</option>
              </Form.Select></Form.Group></Col>
              <Col md={4}><Form.Group><Form.Label>Stop-Loss Value</Form.Label><Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
              <Col md={4}><Form.Group><Form.Label>Points Condition</Form.Label><Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
            </Row>
            <Button variant="warning" onClick={handleUpdateConditions}>Update Conditions</Button>
          </Form>
        </Container>
      )}

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton><Modal.Title>Register User</Modal.Title></Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type === "success" ? "success" : "danger"}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group><Form.Label>Username</Form.Label><Form.Control type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required /></Form.Group>
            <Form.Group><Form.Label>Password</Form.Label><Form.Control type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required /></Form.Group>
            <Form.Group><Form.Label>Broker</Form.Label><Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
              <option value="Shoonya">Shoonya</option>
            </Form.Select></Form.Group>
            <Form.Group><Form.Label>API Key</Form.Label><Form.Control type="text" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required /></Form.Group>
            <Form.Group><Form.Label>TOTP Token</Form.Label><Form.Control type="text" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required /></Form.Group>
            {formData.broker === "Shoonya" && (
              <Form.Group><Form.Label>Vendor Code</Form.Label><Form.Control type="text" value={formData.vendor_code} onChange={(e) => setFormData({ ...formData, vendor_code: e.target.value })} required /></Form.Group>
            )}
            <Form.Group><Form.Label>Default Quantity</Form.Label><Form.Control type="number" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required /></Form.Group>
            <Button variant="primary" type="submit" className="mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default Landing;